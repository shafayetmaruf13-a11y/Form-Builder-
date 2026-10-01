import { answersSchema, formDocumentSchema } from "@formcraft/schema";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { formVersions, forms, submissions, users } from "@/db/schema";
import { submissionPdfFilename } from "@/server/pdf/keys";
import { getOrRenderSubmissionPdf } from "@/server/pdf/render";

import { newSubmissionMessage } from "./messages";
import { sendEmail } from "./transport";

/**
 * Telling the owner a form was filled in.
 *
 * Called from `after()` on the submit route, so none of this — not the
 * database reads, not a Chromium launch, not a call to Resend — happens before
 * the person filling the form gets their response. Slice 6's rule stands: the
 * one endpoint strangers can reach never waits on a browser.
 *
 * Never throws, for the same reason `sendEmail` never throws. The submission
 * is already stored and acknowledged; a notification that cannot be sent is a
 * row in `email_log`, not a lost response.
 */
export async function notifyOwnerOfSubmission(
  submissionId: string,
): Promise<void> {
  try {
    const [row] = await db
      .select({
        submittedAt: submissions.submittedAt,
        answers: submissions.answers,
        document: formVersions.document,
        formTitle: forms.title,
        notify: forms.notifyOnSubmission,
        ownerEmail: users.email,
        ownerStatus: users.status,
      })
      .from(submissions)
      .innerJoin(formVersions, eq(submissions.formVersionId, formVersions.id))
      .innerJoin(forms, eq(formVersions.formId, forms.id))
      .innerJoin(users, eq(forms.ownerId, users.id))
      .where(eq(submissions.id, submissionId))
      .limit(1);

    if (!row) return;
    if (!row.notify) return;
    if (!row.ownerEmail) return;
    // A suspended account should not be receiving the workspace's data.
    if (row.ownerStatus === "suspended") return;

    const document = formDocumentSchema.safeParse(row.document);
    const answers = answersSchema.safeParse(row.answers ?? {});

    // The PDF is a nicety; the notification is the point. If rendering fails —
    // no browser on the box, a version that will not parse — the owner still
    // learns they have a response, and the mail says the PDF is missing rather
    // than silently arriving without one.
    let pdf: Uint8Array | null = null;
    try {
      const rendered = await getOrRenderSubmissionPdf(submissionId);
      pdf = rendered?.bytes ?? null;
    } catch (error) {
      console.error(`PDF for notification ${submissionId} failed`, error);
    }

    const message = newSubmissionMessage({
      formTitle: row.formTitle,
      document: document.success ? document.data : undefined,
      answers: answers.success ? answers.data : {},
      submittedAt: row.submittedAt,
      hasPdf: pdf !== null,
    });

    await sendEmail({
      to: row.ownerEmail,
      message,
      submissionId,
      attachments: pdf
        ? [
            {
              filename: submissionPdfFilename(row.formTitle, row.submittedAt),
              content: pdf,
            },
          ]
        : undefined,
    });
  } catch (error) {
    // The outermost net. This runs detached from any request, so an escaping
    // error would be an unhandled rejection rather than a 500 anybody sees.
    console.error(`notifying owner of ${submissionId} failed`, error);
  }
}
