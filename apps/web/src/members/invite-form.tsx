"use client";

import { ROLES, type Role } from "@/db/schema";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { inviteMember } from "@/server/members/actions";

/**
 * Invite somebody.
 *
 * There is no separate invitation token: a row is created with `invited`
 * status, and signing in at that address redeems it. One mechanism, nothing
 * extra to expire or leak.
 *
 * Only roles below the inviter's own are offered — inviting somebody as your
 * peer is the same escalation as promoting them there.
 */
export function InviteForm({ actorRole }: { actorRole: Role }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [message, setMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const grantable = ROLES.filter(
    (candidate) =>
      candidate !== "owner" &&
      ROLES.indexOf(candidate) < ROLES.indexOf(actorRole),
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);

    startTransition(async () => {
      const result = await inviteMember(email, role);
      if (result.ok) {
        setMessage({ ok: true, text: `Invited ${email}` });
        setEmail("");
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.error ?? "That did not work" });
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] opacity-70">Email</span>
        <input
          type="email"
          required
          value={email}
          placeholder="colleague@example.com"
          aria-label="Email to invite"
          className="w-64 rounded border border-black/15 bg-transparent px-2 py-1 text-sm outline-none focus:border-blue-500 dark:border-white/20"
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] opacity-70">Role</span>
        <select
          value={role}
          aria-label="Role to invite as"
          className="rounded border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
          onChange={(event) => setRole(event.target.value as Role)}
        >
          {grantable.map((candidate) => (
            <option key={candidate} value={candidate}>
              {candidate}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "Inviting…" : "Invite"}
      </button>

      {message && (
        <p
          role="status"
          className={
            message.ok
              ? "text-[11px] text-green-700 dark:text-green-300"
              : "text-[11px] text-red-700 dark:text-red-300"
          }
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
