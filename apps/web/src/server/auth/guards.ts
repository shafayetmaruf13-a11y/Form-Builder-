import { eq } from "drizzle-orm";

import { db } from "@/db";
import { forms } from "@/db/schema";

import { canReadForm, canWriteForm } from "./permissions";
import { getCurrentUser } from "./session";

/**
 * Permission checks that need the database.
 *
 * Kept apart from `permissions.ts`, which stays pure and exhaustively tested.
 * Everything here is the same shape: load the thing's owner, then ask the pure
 * rules. No route decides for itself what a role means.
 */

/**
 * Whether the caller may read or write a particular form.
 *
 * Returns false rather than throwing for a missing form, so callers can treat
 * not-found and not-permitted identically — which they should, since telling
 * somebody a form exists but is not theirs is itself a disclosure.
 */
export async function canActOnForm(
  formId: string,
  access: "read" | "write",
): Promise<boolean> {
  const actor = await getCurrentUser();
  if (!actor) return false;

  const [row] = await db
    .select({ ownerId: forms.ownerId })
    .from(forms)
    .where(eq(forms.id, formId))
    .limit(1);

  if (!row) return false;

  return access === "read"
    ? canReadForm(actor, row.ownerId)
    : canWriteForm(actor, row.ownerId);
}
