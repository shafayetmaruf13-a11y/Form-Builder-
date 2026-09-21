"use server";

import { emptyDocument, formDocumentSchema } from "@formcraft/schema";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { formVersions, forms, submissions } from "@/db/schema";

import { canActOnForm } from "@/server/auth/guards";
import { requirePermission, requireUser } from "@/server/auth/session";

import { copyTitle } from "./naming";
import { listTitles } from "./queries";

/**
 * Library mutations.
 *
 * Server actions rather than route handlers: these are invoked from forms and
 * buttons, and `revalidatePath` keeps the library fresh without a client-side
 * cache to reason about. Autosave is the exception — it runs from the builder's
 * save loop, so it is a route handler.
 */

/** Creates an empty form and opens it. */
export async function createForm(): Promise<never> {
  const actor = await requirePermission("form:create");

  const id = nanoid();
  const document = emptyDocument(id, nanoid());

  await db.insert(forms).values({
    id,
    ownerId: actor.id,
    title: document.title,
    draftDocument: document,
  });

  revalidatePath("/forms");
  redirect(`/forms/${id}`);
}

export async function renameForm(id: string, title: string): Promise<void> {
  const trimmed = title.trim().slice(0, 200);
  if (!trimmed) return;
  if (!(await canActOnForm(id, "write"))) return;

  // One statement: the column and the document's own title move together, so
  // the library and the renderer can never disagree about what a form is
  // called.
  await db
    .update(forms)
    .set({
      title: trimmed,
      draftDocument: sql`jsonb_set(${forms.draftDocument}, '{title}', ${JSON.stringify(trimmed)}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(eq(forms.id, id));

  revalidatePath("/forms");
  revalidatePath(`/forms/${id}`);
}

/**
 * Copies a form.
 *
 * Element ids are kept: they only have to be unique within a document, and
 * answers are resolved against the version they were filled against, so two
 * documents sharing element ids never confuses anything. Regenerating them
 * would only invent work.
 */
export async function duplicateForm(id: string): Promise<void> {
  const actor = await requireUser();
  if (!(await canActOnForm(id, "read"))) return;

  const [source] = await db
    .select()
    .from(forms)
    .where(eq(forms.id, id))
    .limit(1);

  if (!source) return;

  const parsed = formDocumentSchema.safeParse(source.draftDocument);
  if (!parsed.success) return;

  const newId = nanoid();
  // The copy belongs to whoever made it, not to the original's owner.
  const title = copyTitle(source.title, await listTitles(actor.id));

  await db.insert(forms).values({
    id: newId,
    ownerId: actor.id,
    title,
    draftDocument: { ...parsed.data, id: newId, title },
  });

  revalidatePath("/forms");
}

/** How much a delete would destroy, so the confirmation can say so. */
export async function formImpact(
  id: string,
): Promise<{ versions: number; submissions: number }> {
  if (!(await canActOnForm(id, "read"))) {
    return { versions: 0, submissions: 0 };
  }

  const [versionRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(formVersions)
    .where(eq(formVersions.formId, id));

  const [submissionRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(submissions)
    .innerJoin(formVersions, eq(submissions.formVersionId, formVersions.id))
    .where(eq(formVersions.formId, id));

  return {
    versions: versionRow?.count ?? 0,
    submissions: submissionRow?.count ?? 0,
  };
}

/**
 * Deletes a form.
 *
 * This cascades: versions go, and with them every submission ever made against
 * them. That is a lot to take on one click, which is why the UI asks with the
 * counts from `formImpact` in the question rather than a generic "are you
 * sure".
 */
export async function deleteForm(id: string): Promise<void> {
  if (!(await canActOnForm(id, "write"))) return;

  await db.delete(forms).where(eq(forms.id, id));

  revalidatePath("/forms");
}
