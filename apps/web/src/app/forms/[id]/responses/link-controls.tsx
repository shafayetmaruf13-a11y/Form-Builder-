"use client";

import { useState, useTransition } from "react";

import {
  addLinkToVersion,
  restoreLink,
  revokeLink,
} from "@/server/publish/actions";

/**
 * The share links on one published version.
 *
 * Revoking rather than deleting throughout: submissions reference the link they
 * came through, and a link nobody can use is still a record of how a response
 * arrived.
 */

export interface LinkRow {
  id: string;
  slug: string;
  revoked: boolean;
  expiresAt: Date | null;
  maxUses: number | null;
  usesCount: number;
}

export function LinkControls({
  versionId,
  links,
}: {
  versionId: string;
  links: LinkRow[];
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      {links.map((link) => (
        <LinkRowView key={link.id} link={link} pending={pending} />
      ))}

      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            // The new slug arrives in the revalidated page, so the return
            // value is deliberately dropped here.
            await addLinkToVersion(versionId);
          })
        }
        className="text-xs underline opacity-70 hover:opacity-100 disabled:opacity-40"
      >
        Add another link to this version
      </button>
    </div>
  );
}

function LinkRowView({ link, pending }: { link: LinkRow; pending: boolean }) {
  const [copied, setCopied] = useState(false);
  const [busy, startTransition] = useTransition();
  const disabled = pending || busy;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <code
        className={`rounded bg-black/5 px-2 py-1 font-mono dark:bg-white/10 ${
          link.revoked ? "line-through opacity-50" : ""
        }`}
      >
        /f/{link.slug}
      </code>

      <button
        type="button"
        disabled={link.revoked}
        onClick={async () => {
          try {
            // Built from the browser's own origin: an environment variable is
            // how share links end up pointing at localhost.
            await navigator.clipboard.writeText(
              `${window.location.origin}/f/${link.slug}`,
            );
            setCopied(true);
          } catch {
            // Clipboard refused; the slug is on screen to copy by hand.
          }
        }}
        className="underline opacity-70 hover:opacity-100 disabled:no-underline disabled:opacity-30"
      >
        {copied ? "Copied" : "Copy link"}
      </button>

      <span className="opacity-60">
        {link.usesCount} {link.usesCount === 1 ? "use" : "uses"}
        {link.maxUses !== null && ` of ${link.maxUses}`}
      </span>

      {link.expiresAt && (
        <span className="opacity-60">
          · expires{" "}
          {new Date(link.expiresAt).toLocaleDateString(undefined, {
            dateStyle: "medium",
          })}
        </span>
      )}

      {link.revoked && (
        <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-800 dark:bg-red-900/40 dark:text-red-200">
          revoked
        </span>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          startTransition(() =>
            link.revoked ? restoreLink(link.id) : revokeLink(link.id),
          )
        }
        className="ml-auto underline opacity-70 hover:opacity-100 disabled:opacity-40"
      >
        {link.revoked ? "Restore" : "Revoke"}
      </button>
    </div>
  );
}
