"use server";

import { emptyDocument, formDocumentSchema } from "@formcraft/schema";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { formVersions, forms, submissions } from "@/db/schema";

import { copyTitle } from "./naming";
import { currentOwnerId, listTitles } from "./queries";

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
  const id = nanoid();
  const document = emptyDocument(id, nanoid());

  await db.insert(forms).values({
    id,
    ownerId: currentOwnerId(),
    title: document.title,
    draftDocument: document,
  });

  revalidatePath("/forms");
  redirect(`/forms/${id}`);
}

export async function renameForm(id: string, title: string): Promise<void> {
  const trimmed = title.trim().slice(0, 200);
  if (!trimmed) return;

  await db
    .update(forms)
    .set({ title: trimmed, updatedAt: new Date() })
    .where(and(eq(forms.id, id), eq(forms.ownerId, currentOwnerId())));

  // The title lives in the document too, so the renderer and any future PDF
  // header agree with the library.
  await db
    .update(forms)
    .set({
      draftDocument: sql`jsonb_set(${forms.draftDocument}, '{title}', ${JSON.stringify(trimmed)}::jsonb)`,
    })
    .where(and(eq(forms.id, id), eq(forms.ownerId, currentOwnerId())));

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
  const [source] = await db
    .select()
    .from(forms)
    .where(and(eq(forms.id, id), eq(forms.ownerId, currentOwnerId())))
    .limit(1);

  if (!source) return;

  const parsed = formDocumentSchema.safeParse(source.draftDocument);
  if (!parsed.success) return;

  const newId = nanoid();
  const title = copyTitle(source.title, await listTitles());

  await db.insert(forms).values({
    id: newId,
    ownerId: currentOwnerId(),
    title,
    draftDocument: { ...parsed.data, id: newId, title },
  });

  revalidatePath("/forms");
}

/** How much a delete would destroy, so the confirmation can say so. */
export async function formImpact(
  id: string,
): Promise<{ versions: number; submissions: number }> {
  const owned = and(eq(forms.id, id), eq(forms.ownerId, currentOwnerId()));

  const [form] = await db
    .select({ id: forms.id })
    .from(forms)
    .where(owned)
    .limit(1);
  if (!form) return { versions: 0, submissions: 0 };

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
  await db
    .delete(forms)
    .where(and(eq(forms.id, id), eq(forms.ownerId, currentOwnerId())));

  revalidatePath("/forms");
}
