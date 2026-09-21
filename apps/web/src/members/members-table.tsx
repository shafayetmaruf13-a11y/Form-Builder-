"use client";

import { ROLES, type Role } from "@/db/schema";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cn } from "@/lib/utils";
import type { Actor } from "@/server/auth/permissions";
import {
  canActOnMember,
  canSetRole,
  canTransferOwnership,
  REFUSAL_MESSAGE,
} from "@/server/auth/permissions";
import type { Member } from "@/server/members/queries";
import {
  removeMember,
  setMemberRole,
  setMemberSuspended,
  transferOwnership,
} from "@/server/members/actions";

const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  moderator: "Moderator",
  user: "User",
};

const ROLE_BLURB: Record<Role, string> = {
  owner: "Everything, and decides who the admins are",
  admin: "Manages members, sees and edits every form",
  moderator: "Sees and exports responses; cannot edit forms or members",
  user: "Builds and publishes their own forms",
};

/**
 * The members table.
 *
 * Every control asks the same pure rules the server does, so a button is
 * disabled for exactly the reason the action would refuse — and its tooltip is
 * that reason. The server re-checks regardless: this is about not offering
 * somebody an action that will fail, not about security.
 */
export function MembersTable({
  members,
  actor,
}: {
  members: Member[];
  actor: Actor;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "That did not work");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p
          role="alert"
          className="rounded bg-red-100 px-3 py-2 text-xs text-red-900 dark:bg-red-900/40 dark:text-red-100"
        >
          {error}
        </p>
      )}

      <div
        className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/15"
        style={{ opacity: pending ? 0.6 : 1 }}
      >
        <table className="w-full text-sm">
          <thead className="border-b border-black/10 text-left text-[11px] uppercase tracking-wide opacity-60 dark:border-white/15">
            <tr>
              <th className="px-3 py-2 font-medium">Member</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Forms</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const isSelf = member.id === actor.id;
              const roleRefusal = canSetRole(actor, member, "user");
              const suspendRefusal = canActOnMember(
                actor,
                member,
                "member:suspend",
              );
              const removeRefusal = canActOnMember(
                actor,
                member,
                "member:remove",
              );
              const transferRefusal = canTransferOwnership(actor, member);

              return (
                <tr
                  key={member.id}
                  data-member={member.id}
                  className="border-b border-black/5 last:border-0 dark:border-white/10"
                >
                  <td className="px-3 py-2">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {member.name ?? member.email}
                        {isSelf && (
                          <span className="ml-1 opacity-50">(you)</span>
                        )}
                      </span>
                      {member.name && (
                        <span className="text-[11px] opacity-60">
                          {member.email}
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="px-3 py-2">
                    <select
                      aria-label={`Role for ${member.email}`}
                      value={member.role}
                      disabled={roleRefusal !== null}
                      title={
                        roleRefusal ? REFUSAL_MESSAGE[roleRefusal] : undefined
                      }
                      className="rounded border border-black/15 bg-transparent px-1.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20"
                      onChange={(event) =>
                        run(() =>
                          setMemberRole(member.id, event.target.value as Role),
                        )
                      }
                    >
                      {ROLES.map((role) => (
                        <option
                          key={role}
                          value={role}
                          // Owner is never granted by promotion; it moves only
                          // by transfer.
                          disabled={role === "owner"}
                        >
                          {ROLE_LABEL[role]}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="px-3 py-2">
                    <StatusBadge status={member.status} />
                  </td>

                  <td className="px-3 py-2 tabular-nums opacity-70">
                    {member.formCount}
                  </td>

                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <RowButton
                        refusal={suspendRefusal}
                        onClick={() =>
                          run(() =>
                            setMemberSuspended(
                              member.id,
                              member.status !== "suspended",
                            ),
                          )
                        }
                      >
                        {member.status === "suspended" ? "Restore" : "Suspend"}
                      </RowButton>

                      <RowButton
                        refusal={removeRefusal}
                        onClick={() => {
                          const warning =
                            member.formCount > 0
                              ? `\n\nThis also permanently deletes their ${member.formCount} form${
                                  member.formCount === 1 ? "" : "s"
                                }.`
                              : "";
                          if (
                            !window.confirm(
                              `Remove ${member.email}?${warning}\n\nThis cannot be undone.`,
                            )
                          ) {
                            return;
                          }
                          run(() => removeMember(member.id));
                        }}
                      >
                        Remove
                      </RowButton>

                      <RowButton
                        refusal={transferRefusal}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Make ${member.email} the owner?\n\nYou will become an admin and cannot undo this yourself.`,
                            )
                          ) {
                            return;
                          }
                          run(() => transferOwnership(member.id));
                        }}
                      >
                        Make owner
                      </RowButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] opacity-60">
        {ROLES.map((role) => (
          <div key={role} className="flex gap-1">
            <dt className="font-medium">{ROLE_LABEL[role]}:</dt>
            <dd>{ROLE_BLURB[role]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function StatusBadge({ status }: { status: Member["status"] }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[11px]",
        status === "active" &&
          "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100",
        status === "invited" &&
          "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
        status === "suspended" &&
          "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
      )}
    >
      {status === "invited"
        ? "Invited"
        : status === "active"
          ? "Active"
          : "Suspended"}
    </span>
  );
}

function RowButton({
  children,
  onClick,
  refusal,
}: {
  children: React.ReactNode;
  onClick: () => void;
  refusal: ReturnType<typeof canActOnMember>;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={refusal !== null}
      // The tooltip is the reason the server would give, so a disabled control
      // explains itself rather than just being dead.
      title={refusal ? REFUSAL_MESSAGE[refusal] : undefined}
      className="rounded border border-black/10 px-1.5 py-0.5 text-[11px] hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/10"
    >
      {children}
    </button>
  );
}
