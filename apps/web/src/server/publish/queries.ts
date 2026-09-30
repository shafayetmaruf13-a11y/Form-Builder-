import { type FormDocument, formDocumentSchema } from "@formcraft/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { formLinks, formVersions, forms, submissions } from "@/db/schema";

import { isSlugShaped, secretEquals } from "./slug";

/**
 * Reading a public link.
 *
 * Everything a fill page needs, and nothing it doesn't: no owner, no draft, no
 * other versions. A public page is an untrusted surface (rule 6) and the less
 * it is handed, the less there is to leak.
 */

export type LinkRefusal =
  "not-found" | "revoked" | "expired" | "used-up" | "needs-token" | "bad-token";

export interface OpenLink {
  linkId: string;
  formVersionId: string;
  formId: string;
  version: number;
  document: FormDocument;
  title: string;
}

export type LinkLookup =
  { ok: true; link: OpenLink } | { ok: false; reason: LinkRefusal };

/**
 * Resolves a slug to a version somebody may fill in.
 *
 * Every refusal except `bad-token` is reported to the visitor as the same
 * "this link doesn't work" page. The distinction exists for the owner's benefit
 * and for tests — telling a stranger whether a slug exists but has expired, as
 * against never having existed, is an oracle they have no business having.
 */
export async function openLink(
  slug: string,
  token?: string | null,
): Promise<LinkLookup> {
  // Rejected before the database is touched, so scanning `/f/<junk>` costs a
  // regex rather than a query.
  if (!isSlugShaped(slug)) return { ok: false, reason: "not-found" };

  const [row] = await db
    .select({
      linkId: formLinks.id,
      revoked: formLinks.revoked,
      token: formLinks.token,
      expiresAt: formLinks.expiresAt,
      maxUses: formLinks.maxUses,
      usesCount: formLinks.usesCount,
      formVersionId: formVersions.id,
      formId: formVersions.formId,
      version: formVersions.version,
      document: formVersions.document,
      title: forms.title,
    })
    .from(formLinks)
    .innerJoin(formVersions, eq(formLinks.formVersionId, formVersions.id))
    .innerJoin(forms, eq(formVersions.formId, forms.id))
    .where(eq(formLinks.slug, slug))
    .limit(1);

  if (!row) return { ok: false, reason: "not-found" };
  if (row.revoked) return { ok: false, reason: "revoked" };

  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  if (row.maxUses !== null && row.usesCount >= row.maxUses) {
    return { ok: false, reason: "used-up" };
  }

  if (row.token) {
    if (!token) return { ok: false, reason: "needs-token" };
    if (!secretEquals(row.token, token)) {
      return { ok: false, reason: "bad-token" };
    }
  }

  // The version is immutable, but it was written by an older build of this app
  // and is parsed rather than trusted — rule 4 promises it still renders, and
  // the schema is what decides whether that is true.
  const parsed = formDocumentSchema.safeParse(row.document);
  if (!parsed.success) return { ok: false, reason: "not-found" };

  return {
    ok: true,
    link: {
      linkId: row.linkId,
      formVersionId: row.formVersionId,
      formId: row.formId,
      version: row.version,
      document: parsed.data,
      title: row.title,
    },
  };
}

/**
 * Increments a link's use counter.
 *
 * Conditional on the cap in the same statement, so two simultaneous submissions
 * against a one-use link cannot both succeed. Returns whether this caller got
 * one of the uses.
 */
export async function claimUse(linkId: string): Promise<boolean> {
  const claimed = await db
    .update(formLinks)
    .set({ usesCount: sql`${formLinks.usesCount} + 1` })
    .where(
      and(
        eq(formLinks.id, linkId),
        eq(formLinks.revoked, false),
        // `max_uses IS NULL` means uncapped.
        sql`(${formLinks.maxUses} IS NULL OR ${formLinks.usesCount} < ${formLinks.maxUses})`,
      ),
    )
    .returning({ id: formLinks.id });

  return claimed.length > 0;
}

// ---------------------------------------------------------------------------
// The owner's side
// ---------------------------------------------------------------------------

export interface VersionSummary {
  id: string;
  version: number;
  publishedAt: Date;
  submissions: number;
  links: {
    id: string;
    slug: string;
    revoked: boolean;
    expiresAt: Date | null;
    maxUses: number | null;
    usesCount: number;
  }[];
}

/** Every published version of a form, newest first, with its links. */
export async function listVersions(formId: string): Promise<VersionSummary[]> {
  const versions = await db
    .select({
      id: formVersions.id,
      version: formVersions.version,
      publishedAt: formVersions.publishedAt,
      submissions: sql<number>`(
        select count(*)::int from ${submissions}
        where ${submissions.formVersionId} = ${formVersions.id}
      )`,
    })
    .from(formVersions)
    .where(eq(formVersions.formId, formId))
    .orderBy(desc(formVersions.version));

  if (versions.length === 0) return [];

  const links = await db
    .select({
      id: formLinks.id,
      formVersionId: formLinks.formVersionId,
      slug: formLinks.slug,
      revoked: formLinks.revoked,
      expiresAt: formLinks.expiresAt,
      maxUses: formLinks.maxUses,
      usesCount: formLinks.usesCount,
    })
    .from(formLinks)
    .innerJoin(formVersions, eq(formLinks.formVersionId, formVersions.id))
    .where(eq(formVersions.formId, formId))
    .orderBy(desc(formLinks.createdAt));

  // Grouped in memory rather than as a join: a form has a handful of versions
  // and a handful of links, and one row per (version, link) would duplicate
  // every version's counts.
  return versions.map((version) => ({
    ...version,
    links: links
      .filter((link) => link.formVersionId === version.id)
      .map((link) => ({
        id: link.id,
        slug: link.slug,
        revoked: link.revoked,
        expiresAt: link.expiresAt,
        maxUses: link.maxUses,
        usesCount: link.usesCount,
      })),
  }));
}

export interface SubmissionRow {
  id: string;
  submittedAt: Date;
  version: number;
  formVersionId: string;
  answers: Record<string, unknown>;
}

/**
 * Submissions to a form, newest first.
 *
 * Across every version, because "the replies to my form" is what an owner
 * means — the version each one was filled against travels with it so the table
 * can render each row against the right document (rule 4).
 */
export async function listSubmissions(
  formId: string,
  limit = 200,
): Promise<SubmissionRow[]> {
  const rows = await db
    .select({
      id: submissions.id,
      submittedAt: submissions.submittedAt,
      version: formVersions.version,
      formVersionId: submissions.formVersionId,
      answers: submissions.answers,
    })
    .from(submissions)
    .innerJoin(formVersions, eq(submissions.formVersionId, formVersions.id))
    .where(eq(formVersions.formId, formId))
    .orderBy(desc(submissions.submittedAt))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    answers: (row.answers ?? {}) as Record<string, unknown>,
  }));
}

/**
 * Every published version's document, newest first.
 *
 * The version id travels with the document because a `FormDocument`'s own `id`
 * is the *form's* id and is identical in every version — so a document cannot
 * say which version it is, and the Excel export has to know.
 */
export async function versionedDocuments(
  formId: string,
): Promise<
  { formVersionId: string; version: number; document: FormDocument }[]
> {
  const rows = await db
    .select({
      formVersionId: formVersions.id,
      version: formVersions.version,
      document: formVersions.document,
    })
    .from(formVersions)
    .where(eq(formVersions.formId, formId))
    .orderBy(desc(formVersions.version));

  const versions: {
    formVersionId: string;
    version: number;
    document: FormDocument;
  }[] = [];

  for (const row of rows) {
    // A version that no longer parses is skipped rather than failing the whole
    // export: one unreadable old version must not cost the owner every other
    // response they have.
    const parsed = formDocumentSchema.safeParse(row.document);
    if (!parsed.success) continue;

    versions.push({
      formVersionId: row.formVersionId,
      version: row.version,
      document: parsed.data,
    });
  }

  return versions;
}

/** The documents a set of submissions were filled against, by version id. */
export async function documentsForVersions(
  versionIds: string[],
): Promise<Map<string, FormDocument>> {
  const unique = [...new Set(versionIds)];
  if (unique.length === 0) return new Map();

  const rows = await db
    .select({ id: formVersions.id, document: formVersions.document })
    .from(formVersions)
    .where(inArray(formVersions.id, unique));

  const byId = new Map<string, FormDocument>();
  for (const row of rows) {
    const parsed = formDocumentSchema.safeParse(row.document);
    if (parsed.success) byId.set(row.id, parsed.data);
  }

  return byId;
}
