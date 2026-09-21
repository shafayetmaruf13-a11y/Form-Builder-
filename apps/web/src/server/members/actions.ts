"use server";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { type Role, ROLES, users } from "@/db/schema";
import {
  REFUSAL_MESSAGE,
  type Refusal,
  canActOnMember,
  canSetRole,
  canTransferOwnership,
} from "@/server/auth/permissions";
import { requirePermission, requireUser } from "@/server/auth/session";

/**
 * Member management.
 *
 * Every one of these re-checks permission here, in the action, rather than
 * trusting that the dashboard only rendered buttons the caller was allowed to
 * press. A server action is a public endpoint — anyone can invoke it. The UI
 * hiding a button is a courtesy, not a control.
 */

export interface MemberActionResult {
  ok: boolean;
  error?: string;
}

function refuse(refusal: Refusal): MemberActionResult {
  return { ok: false, error: REFUSAL_MESSAGE[refusal] };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Invites somebody by email.
 *
 * Creates an `invited` row and nothing else. The invitation is redeemed by
 * signing in with that address — Auth.js's email link is the invitation, so
 * there is no separate token to expire or leak.
 */
export async function inviteMember(
  email: string,
  role: Role,
): Promise<MemberActionResult> {
  const actor = await requirePermission("member:invite").catch(() => null);
  if (!actor) return refuse("not-permitted");

  const address = email.trim().toLowerCase();
  if (!EMAIL.test(address)) {
    return { ok: false, error: "That does not look like an email address" };
  }

  if (!ROLES.includes(role)) return refuse("not-permitted");

  // Inviting somebody at or above your own rank is the same escalation as
  // promoting them there, so it is refused for the same reason.
  const refusal = canSetRole(actor, { id: "new", role: "user" }, role);
  if (refusal) return refuse(refusal);

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, address))
    .limit(1);

  if (existing) {
    return { ok: false, error: "That person is already a member" };
  }

  await db.insert(users).values({
    id: nanoid(),
    email: address,
    role,
    status: "invited",
    invitedByUserId: actor.id,
  });

  revalidatePath("/members");
  return { ok: true };
}

export async function setMemberRole(
  memberId: string,
  role: Role,
): Promise<MemberActionResult> {
  const actor = await requireUser().catch(() => null);
  if (!actor) return refuse("not-permitted");
  if (!ROLES.includes(role)) return refuse("not-permitted");

  const target = await loadMember(memberId);
  if (!target) return { ok: false, error: "No such member" };

  const refusal = canSetRole(actor, target, role);
  if (refusal) return refuse(refusal);

  await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, memberId));

  revalidatePath("/members");
  return { ok: true };
}

export async function setMemberSuspended(
  memberId: string,
  suspended: boolean,
): Promise<MemberActionResult> {
  const actor = await requireUser().catch(() => null);
  if (!actor) return refuse("not-permitted");

  const target = await loadMember(memberId);
  if (!target) return { ok: false, error: "No such member" };

  const refusal = canActOnMember(actor, target, "member:suspend");
  if (refusal) return refuse(refusal);

  // Un-suspending returns somebody to `active` only if they had signed in;
  // an invitation that was never redeemed goes back to `invited`.
  const next = suspended
    ? "suspended"
    : target.emailVerified
      ? "active"
      : "invited";

  await db
    .update(users)
    .set({ status: next, updatedAt: new Date() })
    .where(eq(users.id, memberId));

  revalidatePath("/members");
  return { ok: true };
}

/**
 * Removes a member.
 *
 * `forms.owner_id` cascades, so this destroys everything they built. The
 * dashboard says so with the count before asking.
 */
export async function removeMember(
  memberId: string,
): Promise<MemberActionResult> {
  const actor = await requireUser().catch(() => null);
  if (!actor) return refuse("not-permitted");

  const target = await loadMember(memberId);
  if (!target) return { ok: false, error: "No such member" };

  const refusal = canActOnMember(actor, target, "member:remove");
  if (refusal) return refuse(refusal);

  await db.delete(users).where(eq(users.id, memberId));

  revalidatePath("/members");
  return { ok: true };
}

/**
 * Hands the workspace to somebody else.
 *
 * Both writes happen in one transaction because the database permits exactly
 * one owner — demote and promote have to be a single step or the constraint
 * fires and the workspace is left without an owner.
 */
export async function transferOwnership(
  memberId: string,
): Promise<MemberActionResult> {
  const actor = await requireUser().catch(() => null);
  if (!actor) return refuse("not-permitted");

  const target = await loadMember(memberId);
  if (!target) return { ok: false, error: "No such member" };

  const refusal = canTransferOwnership(actor, target);
  if (refusal) return refuse(refusal);

  await db.transaction(async (tx) => {
    // Demote first: the partial unique index allows only one 'owner' row.
    await tx
      .update(users)
      .set({ role: "admin", updatedAt: new Date() })
      .where(eq(users.id, actor.id));

    await tx
      .update(users)
      .set({ role: "owner", updatedAt: new Date() })
      .where(eq(users.id, memberId));
  });

  revalidatePath("/members");
  return { ok: true };
}

async function loadMember(id: string) {
  const [row] = await db
    .select({
      id: users.id,
      role: users.role,
      status: users.status,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  return row ?? null;
}
