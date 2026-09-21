import { type FormDocument, formDocumentSchema } from "@formcraft/schema";
import { and, desc, eq, ilike } from "drizzle-orm";

import { db } from "@/db";
import { forms } from "@/db/schema";
import { env } from "@/env";

/**
 * Reads of the current owner's forms.
 *
 * Every query filters by owner. There is one hardcoded dev user today, so that
 * filter is currently a formality — which is exactly why it has to be written
 * now. Adding auth later becomes a change to `currentOwnerId()` rather than an
 * audit of every query for the one that forgot.
 */
function currentOwnerId(): string {
  return env.DEV_USER_ID;
}

export interface FormSummary {
  id: string;
  title: string;
  updatedAt: Date;
  /**
   * The full draft, because library thumbnails render the real document rather
   * than a stored image. Heavier than a list needs; see the decisions log.
   */
  document: FormDocument;
}

/** The owner's forms, most recently edited first. */
export async function listForms(query?: string): Promise<FormSummary[]> {
  const filters = [eq(forms.ownerId, currentOwnerId())];
  // ilike, so search is case-insensitive without a functional index.
  if (query?.trim()) filters.push(ilike(forms.title, `%${query.trim()}%`));

  const rows = await db
    .select({
      id: forms.id,
      title: forms.title,
      updatedAt: forms.updatedAt,
      draftDocument: forms.draftDocument,
    })
    .from(forms)
    .where(and(...filters))
    .orderBy(desc(forms.updatedAt));

  return rows.flatMap((row) => {
    // A row whose document no longer parses is skipped rather than allowed to
    // take the whole library page down with it.
    const parsed = formDocumentSchema.safeParse(row.draftDocument);
    if (!parsed.success) return [];

    return [
      {
        id: row.id,
        title: row.title,
        updatedAt: row.updatedAt,
        document: parsed.data,
      },
    ];
  });
}

export interface StoredForm {
  id: string;
  title: string;
  updatedAt: Date;
  document: FormDocument;
}

/** One form, or null if it does not exist or is not this owner's. */
export async function getForm(id: string): Promise<StoredForm | null> {
  const [row] = await db
    .select()
    .from(forms)
    .where(and(eq(forms.id, id), eq(forms.ownerId, currentOwnerId())))
    .limit(1);

  if (!row) return null;

  const parsed = formDocumentSchema.safeParse(row.draftDocument);
  if (!parsed.success) return null;

  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt,
    document: parsed.data,
  };
}

/** Existing titles, used to number a duplicate without colliding. */
export async function listTitles(): Promise<string[]> {
  const rows = await db
    .select({ title: forms.title })
    .from(forms)
    .where(eq(forms.ownerId, currentOwnerId()));

  return rows.map((row) => row.title);
}

export { currentOwnerId };
