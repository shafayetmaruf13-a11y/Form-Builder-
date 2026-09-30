import { type Answers, answersSchema } from "@formcraft/schema";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { formVersions, forms, submissions } from "@/db/schema";
import { canReadSubmissions } from "@/server/auth/permissions";
import { getCurrentUser } from "@/server/auth/session";

/**
 * Who may export what.
 *
 * Shared by both export routes and by the PDF route's sibling logic, so the
 * answer cannot differ between formats. Not-found and not-permitted are the
 * same result throughout, as everywhere else in this app.
 */

export interface SubmissionForExport {
  id: string;
  submittedAt: Date;
  version: number;
  formVersionId: string;
  answers: Answers;
  formId: string;
  formTitle: string;
}

/** A submission the current actor may read, or null. */
export async function readableSubmission(
  submissionId: string,
): Promise<SubmissionForExport | null> {
  const actor = await getCurrentUser().catch(() => null);
  if (!actor) return null;

  const [row] = await db
    .select({
      id: submissions.id,
      submittedAt: submissions.submittedAt,
      version: formVersions.version,
      formVersionId: submissions.formVersionId,
      answers: submissions.answers,
      formId: forms.id,
      formTitle: forms.title,
      formOwnerId: forms.ownerId,
    })
    .from(submissions)
    .innerJoin(formVersions, eq(submissions.formVersionId, formVersions.id))
    .innerJoin(forms, eq(formVersions.formId, forms.id))
    .where(eq(submissions.id, submissionId))
    .limit(1);

  if (!row) return null;
  if (!canReadSubmissions(actor, row.formOwnerId)) return null;

  const answers = answersSchema.safeParse(row.answers ?? {});

  return {
    id: row.id,
    submittedAt: row.submittedAt,
    version: row.version,
    formVersionId: row.formVersionId,
    answers: answers.success ? answers.data : {},
    formId: row.formId,
    formTitle: row.formTitle,
  };
}

/** A form whose responses the current actor may read, or null. */
export async function readableForm(
  formId: string,
): Promise<{ id: string; title: string } | null> {
  const actor = await getCurrentUser().catch(() => null);
  if (!actor) return null;

  const [row] = await db
    .select({ id: forms.id, title: forms.title, ownerId: forms.ownerId })
    .from(forms)
    .where(eq(forms.id, formId))
    .limit(1);

  if (!row) return null;
  if (!canReadSubmissions(actor, row.ownerId)) return null;

  return { id: row.id, title: row.title };
}
