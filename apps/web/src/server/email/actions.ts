"use server";

import { answersSchema, formDocumentSchema } from "@formcraft/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { formVersions, forms, submissions, users } from "@/db/schema";
import { canActOnForm } from "@/server/auth/guards";
import { getCurrentUser } from "@/server/auth/session";
import { submissionPdfFilename } from "@/server/pdf/keys";
import { getOrRenderSubmissionPdf } from "@/server/pdf/render";
import { hit } from "@/server/publish/rate-limit";

import { forwardedSubmissionMessage } from "./messages";
import { sendEmail } from "./transport";

/**
 * Forwarding a response to somebody.
 *
 * This is a feature that sends an attachment from our domain to an address a
 * person types in, which is the shape of a spam relay. Four things keep it
 * from being one:
 *
 *   - only somebody who may read the submission may send it;
 *   - a per-actor rate limit, through the same Postgres limiter the public
 *     fill page uses;
 *   - one recipient per call, so it cannot be used to blast a list;
 *   - every send recorded in `email_log`.
 */

/** Deliberately modest: this is "send this to a colleague", not a mailing list. */
const FORWARD_LIMIT = { max: 20, windowSeconds: 60 * 60 };

export type ForwardResult =
  { ok: true; delivered: "sent" | "logged" } | { ok: false; error: string };

export async function emailSubmission(
  submissionId: string,
  to: string,
  note = "",
): Promise<ForwardResult> {
  const actor = await getCurrentUser().catch(() => null);
  if (!actor) return { ok: false, error: "You are not signed in." };

  const address = to.trim().toLowerCase();

  // Checked here as well as in the browser: rule 5 holds for every input, not
  // only the ones on a public page.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 320) {
    return { ok: false, error: "That does not look like an email address." };
  }

  const [row] = await db
    .select({
      submittedAt: submissions.submittedAt,
      answers: submissions.answers,
      document: formVersions.document,
      formId: forms.id,
      formTitle: forms.title,
    })
    .from(submissions)
    .innerJoin(formVersions, eq(submissions.formVersionId, formVersions.id))
    .innerJoin(forms, eq(formVersions.formId, forms.id))
    .where(eq(submissions.id, submissionId))
    .limit(1);

  // Not-found and not-permitted are the same answer, as everywhere else.
  if (!row) return { ok: false, error: "That response no longer exists." };
  if (!(await canActOnForm(row.formId, "read"))) {
    return { ok: false, error: "That response no longer exists." };
  }

  // Keyed on the actor, not the recipient: what is being limited is how much
  // mail one account can cause, and keying on the recipient would let somebody
  // spray a thousand addresses once each.
  const limit = await hit("submit", `forward:${actor.id}`, FORWARD_LIMIT);
  if (!limit.ok) {
    return {
      ok: false,
      error: "You have sent a lot of these recently. Try again later.",
    };
  }

  // Looked up rather than taken from the actor: `Actor` is deliberately the
  // minimal shape the pure permission functions need, and widening it so one
  // feature can address an email would put an identity detail into the
  // authorization model.
  const [sender] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const senderEmail = sender?.email ?? null;

  const document = formDocumentSchema.safeParse(row.document);
  const answers = answersSchema.safeParse(row.answers ?? {});

  let pdf: Uint8Array | null = null;
  try {
    const rendered = await getOrRenderSubmissionPdf(submissionId);
    pdf = rendered?.bytes ?? null;
  } catch (error) {
    console.error(`PDF for forward of ${submissionId} failed`, error);
  }

  const message = forwardedSubmissionMessage({
    formTitle: row.formTitle,
    document: document.success ? document.data : undefined,
    answers: answers.success ? answers.data : {},
    submittedAt: row.submittedAt,
    note: note.slice(0, 1000),
    senderName: senderEmail ?? "a Formcraft user",
  });

  const outcome = await sendEmail({
    to: address,
    message,
    submissionId,
    // So a reply reaches the person who sent it rather than our sending
    // domain, which nobody monitors.
    replyTo: senderEmail ?? undefined,
    attachments: pdf
      ? [
          {
            filename: submissionPdfFilename(row.formTitle, row.submittedAt),
            content: pdf,
          },
        ]
      : undefined,
  });

  revalidatePath(`/forms/${row.formId}/responses`);

  if (!outcome.ok) {
    return {
      ok: false,
      error: "The email could not be sent. It has been logged.",
    };
  }

  return { ok: true, delivered: outcome.delivered };
}

/** Turns submission notifications on or off for one form. */
export async function setNotifyOnSubmission(
  formId: string,
  notify: boolean,
): Promise<void> {
  if (!(await canActOnForm(formId, "write"))) return;

  await db
    .update(forms)
    .set({ notifyOnSubmission: notify, updatedAt: new Date() })
    .where(eq(forms.id, formId));

  revalidatePath(`/forms/${formId}/responses`);
}
