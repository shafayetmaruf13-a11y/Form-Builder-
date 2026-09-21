"use server";

import { formDocumentSchema } from "@formcraft/schema";
import { desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { formLinks, formVersions, forms, submissions } from "@/db/schema";

import { canActOnForm } from "@/server/auth/guards";

import { type PublishResult, publishProblems } from "./checks";
import { newSlug } from "./slug";

/**
 * Publishing.
 *
 * Architecture rule 4: publishing *snapshots*. The draft stays editable; the
 * version created here is never written to again, because a submission made
 * against it must still re-render identically after the owner has redesigned
 * the form six times.
 */

/**
 * Snapshots the draft into an immutable version and mints a share link.
 *
 * Always a new version and a new link: reusing a slug would change what an
 * already-circulated URL points at, and rule 4 exists to stop exactly that.
 * Earlier links keep working against the version they were published with.
 */
export async function publishForm(formId: string): Promise<PublishResult> {
  if (!(await canActOnForm(formId, "write"))) {
    return {
      ok: false,
      problems: [
        { message: "You do not have permission to publish this form." },
      ],
    };
  }

  const [form] = await db
    .select()
    .from(forms)
    .where(eq(forms.id, formId))
    .limit(1);

  if (!form) {
    return {
      ok: false,
      problems: [{ message: "That form no longer exists." }],
    };
  }

  const parsed = formDocumentSchema.safeParse(form.draftDocument);
  if (!parsed.success) {
    return {
      ok: false,
      problems: [
        {
          message:
            "This form's document is not valid and cannot be published. Reopen it in the builder.",
        },
      ],
    };
  }

  const problems = publishProblems(parsed.data);
  if (problems.length > 0) return { ok: false, problems };

  const slug = newSlug();

  const published = await db.transaction(async (tx) => {
    // Computed inside the transaction against the unique index on
    // (form_id, version): two publishes racing cannot both claim version 3 —
    // one of them fails the constraint rather than silently overwriting.
    const [latest] = await tx
      .select({ version: formVersions.version })
      .from(formVersions)
      .where(eq(formVersions.formId, formId))
      .orderBy(desc(formVersions.version))
      .limit(1);

    const version = (latest?.version ?? 0) + 1;
    const versionId = nanoid();

    await tx.insert(formVersions).values({
      id: versionId,
      formId,
      version,
      document: parsed.data,
    });

    await tx.insert(formLinks).values({
      id: nanoid(),
      formVersionId: versionId,
      slug,
    });

    return version;
  });

  revalidatePath("/forms");
  revalidatePath(`/forms/${formId}`);

  return { ok: true, slug, version: published };
}

/**
 * Stops a link working, without destroying anything.
 *
 * Revoking rather than deleting: submissions reference the link they came
 * through, and a deleted link would leave those rows pointing at nothing.
 */
export async function revokeLink(linkId: string): Promise<void> {
  const link = await db
    .select({ formId: formVersions.formId })
    .from(formLinks)
    .innerJoin(formVersions, eq(formLinks.formVersionId, formVersions.id))
    .where(eq(formLinks.id, linkId))
    .limit(1);

  const formId = link[0]?.formId;
  if (!formId) return;
  if (!(await canActOnForm(formId, "write"))) return;

  await db
    .update(formLinks)
    .set({ revoked: true })
    .where(eq(formLinks.id, linkId));

  revalidatePath(`/forms/${formId}`);
}

/** Puts a revoked link back into service. */
export async function restoreLink(linkId: string): Promise<void> {
  const link = await db
    .select({ formId: formVersions.formId })
    .from(formLinks)
    .innerJoin(formVersions, eq(formLinks.formVersionId, formVersions.id))
    .where(eq(formLinks.id, linkId))
    .limit(1);

  const formId = link[0]?.formId;
  if (!formId) return;
  if (!(await canActOnForm(formId, "write"))) return;

  await db
    .update(formLinks)
    .set({ revoked: false })
    .where(eq(formLinks.id, linkId));

  revalidatePath(`/forms/${formId}`);
}

/** Caps how many times a link may be used, or lifts the cap with null. */
export async function setLinkLimits(
  linkId: string,
  limits: { maxUses?: number | null; expiresAt?: Date | null },
): Promise<void> {
  const link = await db
    .select({ formId: formVersions.formId })
    .from(formLinks)
    .innerJoin(formVersions, eq(formLinks.formVersionId, formVersions.id))
    .where(eq(formLinks.id, linkId))
    .limit(1);

  const formId = link[0]?.formId;
  if (!formId) return;
  if (!(await canActOnForm(formId, "write"))) return;

  await db
    .update(formLinks)
    .set({
      ...(limits.maxUses !== undefined ? { maxUses: limits.maxUses } : {}),
      ...(limits.expiresAt !== undefined
        ? { expiresAt: limits.expiresAt }
        : {}),
    })
    .where(eq(formLinks.id, linkId));

  revalidatePath(`/forms/${formId}`);
}

/** Mints an additional link to an already-published version. */
export async function addLinkToVersion(
  versionId: string,
): Promise<string | null> {
  const [version] = await db
    .select({ formId: formVersions.formId })
    .from(formVersions)
    .where(eq(formVersions.id, versionId))
    .limit(1);

  if (!version) return null;
  if (!(await canActOnForm(version.formId, "write"))) return null;

  const slug = newSlug();
  await db.insert(formLinks).values({
    id: nanoid(),
    formVersionId: versionId,
    slug,
  });

  revalidatePath(`/forms/${version.formId}`);
  return slug;
}

/** Whether a form has ever been published, and as what. */
export async function latestVersion(
  formId: string,
): Promise<{ version: number; publishedAt: Date } | null> {
  const [row] = await db
    .select({
      version: formVersions.version,
      publishedAt: formVersions.publishedAt,
    })
    .from(formVersions)
    .where(eq(formVersions.formId, formId))
    .orderBy(desc(formVersions.version))
    .limit(1);

  return row ?? null;
}

/** Counts submissions against a form, across every version of it. */
export async function submissionCount(formId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(submissions)
    .innerJoin(formVersions, eq(submissions.formVersionId, formVersions.id))
    .where(eq(formVersions.formId, formId));

  return row?.count ?? 0;
}
