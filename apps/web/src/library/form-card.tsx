"use client";

import type { FormDocument } from "@formcraft/schema";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import {
  deleteForm,
  duplicateForm,
  formImpact,
  renameForm,
} from "@/server/forms/actions";

/**
 * One form in the library.
 *
 * The thumbnail is rendered on the server and passed in as a child, so this
 * client component carries the menu and the dialogs without also shipping the
 * renderer to the browser twice.
 */
export function FormCard({
  id,
  title,
  updatedAt,
  thumbnail,
}: {
  id: string;
  title: string;
  updatedAt: string;
  document?: FormDocument;
  thumbnail: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);

  function commitRename() {
    setRenaming(false);
    if (draftTitle.trim() === title || !draftTitle.trim()) {
      setDraftTitle(title);
      return;
    }
    startTransition(async () => {
      await renameForm(id, draftTitle);
      router.refresh();
    });
  }

  async function confirmDelete() {
    // The counts go in the question. "Are you sure?" does not tell anyone that
    // they are about to destroy forty responses.
    const impact = await formImpact(id);
    const detail =
      impact.submissions > 0
        ? `\n\nThis will also permanently delete ${impact.submissions} submission${
            impact.submissions === 1 ? "" : "s"
          } across ${impact.versions} published version${
            impact.versions === 1 ? "" : "s"
          }. This cannot be undone.`
        : "\n\nThis cannot be undone.";

    if (!window.confirm(`Delete "${title}"?${detail}`)) return;

    startTransition(async () => {
      await deleteForm(id);
      router.refresh();
    });
  }

  return (
    <div
      data-form-card={id}
      className="flex flex-col gap-2 rounded-lg border border-black/10 p-3 transition-shadow hover:shadow-md dark:border-white/15"
      style={{ opacity: pending ? 0.6 : 1 }}
    >
      <Link
        href={`/forms/${id}`}
        aria-label={`Open ${title}`}
        className="self-center rounded-sm border border-black/10 dark:border-white/15"
      >
        {thumbnail}
      </Link>

      {renaming ? (
        <input
          autoFocus
          value={draftTitle}
          aria-label="Form title"
          className="rounded border border-black/15 bg-transparent px-2 py-1 text-sm outline-none focus:border-blue-500 dark:border-white/20"
          onChange={(event) => setDraftTitle(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setDraftTitle(title);
              setRenaming(false);
            }
          }}
        />
      ) : (
        <Link
          href={`/forms/${id}`}
          className="truncate text-sm font-medium hover:underline"
        >
          {title}
        </Link>
      )}

      {/* Stacked, not side by side: at narrow card widths a single row wraps
          the timestamp into the buttons and looks broken. */}
      <div className="flex flex-col gap-1.5 text-[11px] opacity-60">
        <span>{updatedAt}</span>
        <div className="flex flex-wrap gap-1">
          <CardButton onClick={() => setRenaming(true)}>Rename</CardButton>
          <CardButton
            onClick={() =>
              startTransition(async () => {
                await duplicateForm(id);
                router.refresh();
              })
            }
          >
            Duplicate
          </CardButton>
          <CardButton onClick={() => void confirmDelete()}>Delete</CardButton>
        </div>
      </div>
    </div>
  );
}

function CardButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-black/10 px-1.5 py-0.5 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
    >
      {children}
    </button>
  );
}
