import { type FormDocument, formDocumentSchema } from "@formcraft/schema";
import { and, desc, eq, ilike } from "drizzle-orm";

import { db } from "@/db";
import { forms } from "@/db/schema";
import { can, canReadForm } from "@/server/auth/permissions";
import { requireUser } from "@/server/auth/session";

/**
 * Reads of forms the current user may see.
 *
 * Visibility follows the role: your own always, everyone's if you are an admin
 * or the owner. A moderator deliberately sees no more than a plain user here —
 * they police responses, not other people's designs.
 */

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

/** Forms the current user may see, most recently edited first. */
export async function listForms(query?: string): Promise<FormSummary[]> {
  const actor = await requireUser();

  // An admin's library is everyone's forms; everybody else sees their own.
  const filters = can(actor.role, "form:readAny")
    ? []
    : [eq(forms.ownerId, actor.id)];
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
    .where(filters.length > 0 ? and(...filters) : undefined)
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
  ownerId: string;
  updatedAt: Date;
  document: FormDocument;
  /** Whether this form emails its owner on each new response. */
  notifyOnSubmission: boolean;
}

/** One form, or null if it does not exist or the caller may not see it. */
export async function getForm(id: string): Promise<StoredForm | null> {
  const actor = await requireUser();

  const [row] = await db.select().from(forms).where(eq(forms.id, id)).limit(1);

  // Not-found and not-yours are deliberately the same answer: telling somebody
  // a form exists but is not theirs is itself a disclosure.
  if (!row) return null;
  if (!canReadForm(actor, row.ownerId)) return null;

  const parsed = formDocumentSchema.safeParse(row.draftDocument);
  if (!parsed.success) return null;

  return {
    id: row.id,
    title: row.title,
    ownerId: row.ownerId,
    updatedAt: row.updatedAt,
    document: parsed.data,
    notifyOnSubmission: row.notifyOnSubmission,
  };
}

/** The caller's own titles, used to number a duplicate without colliding. */
export async function listTitles(ownerId: string): Promise<string[]> {
  const rows = await db
    .select({ title: forms.title })
    .from(forms)
    .where(eq(forms.ownerId, ownerId));

  return rows.map((row) => row.title);
}
