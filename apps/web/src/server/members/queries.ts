import { asc, count, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { type Role, type UserStatus, forms, users } from "@/db/schema";
import { ROLES } from "@/db/schema";
import { requirePermission } from "@/server/auth/session";

export interface Member {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: UserStatus;
  formCount: number;
  createdAt: Date;
}

/**
 * Everyone in the workspace.
 *
 * Ordered by rank, most senior first, then by email — a members list sorted by
 * insertion order tells you nothing, and this is the order people look for
 * somebody in.
 *
 * `formCount` is here because removing a member cascades to their forms, and
 * the confirmation should be able to say how many.
 */
export async function listMembers(): Promise<Member[]> {
  await requirePermission("member:read");

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
      formCount: count(forms.id),
    })
    .from(users)
    .leftJoin(forms, eq(forms.ownerId, users.id))
    .groupBy(users.id)
    .orderBy(asc(users.email));

  const rankOf = (role: Role) => ROLES.indexOf(role);

  return rows
    .map((row) => ({ ...row, formCount: Number(row.formCount) }))
    .sort(
      (a, b) =>
        rankOf(b.role) - rankOf(a.role) || a.email.localeCompare(b.email),
    );
}

/** Counts by status, for the dashboard's summary line. */
export async function memberCounts(): Promise<Record<UserStatus, number>> {
  await requirePermission("member:read");

  const rows = await db
    .select({ status: users.status, total: sql<number>`count(*)::int` })
    .from(users)
    .groupBy(users.status);

  const counts: Record<UserStatus, number> = {
    active: 0,
    invited: 0,
    suspended: 0,
  };

  for (const row of rows) counts[row.status] = row.total;
  return counts;
}
