import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { can } from "@/server/auth/permissions";
import { getCurrentUser } from "@/server/auth/session";
import { InviteForm } from "@/members/invite-form";
import { MembersTable } from "@/members/members-table";
import { listMembers, memberCounts } from "@/server/members/queries";

export const metadata: Metadata = { title: "Members — Formcraft" };
export const dynamic = "force-dynamic";

/**
 * The members dashboard.
 *
 * Guarded here and again in every action it can invoke. Rendering a page is not
 * a permission check — a server action is a public endpoint whether or not a
 * button for it was drawn.
 */
export default async function MembersPage() {
  const actor = await getCurrentUser();
  if (!actor) redirect("/sign-in");

  if (!can(actor.role, "member:read")) {
    return (
      <main className="mx-auto max-w-2xl p-10 text-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="mt-3 opacity-70">
          You do not have permission to view the members of this workspace.
        </p>
      </main>
    );
  }

  const [members, counts] = await Promise.all([listMembers(), memberCounts()]);
  const canInvite = can(actor.role, "member:invite");

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-6 sm:p-10">
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="text-xs opacity-60">
          {counts.active} active · {counts.invited} invited · {counts.suspended}{" "}
          suspended
        </p>
        <Link href="/forms" className="ml-auto text-sm underline">
          My forms
        </Link>
      </header>

      {canInvite ? (
        <InviteForm actorRole={actor.role} />
      ) : (
        <p className="text-xs opacity-60">
          Only admins and the owner can invite people.
        </p>
      )}

      <MembersTable members={members} actor={actor} />
    </main>
  );
}
