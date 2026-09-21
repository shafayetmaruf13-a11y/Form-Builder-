"use client";

import type { SaveState } from "./use-autosave";

/**
 * Whether the work is safe.
 *
 * A failed save has to stay on screen — a toast that fades leaves someone
 * editing a document that is no longer being stored, which is the exact
 * failure "nothing is ever lost" is about.
 */
export function SaveStatus({ state }: { state: SaveState }) {
  if (state.status === "conflict") {
    return (
      <span
        role="alert"
        className="rounded bg-amber-100 px-2 py-1 text-[11px] text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
      >
        Changed in another tab — reload before editing further
      </span>
    );
  }

  if (state.status === "error") {
    return (
      <span
        role="alert"
        className="rounded bg-red-100 px-2 py-1 text-[11px] text-red-900 dark:bg-red-900/40 dark:text-red-100"
      >
        Not saved: {state.message}
      </span>
    );
  }

  if (state.status === "saving") {
    return <span className="text-[11px] opacity-60">Saving…</span>;
  }

  if (state.status === "saved") {
    return (
      <span className="text-[11px] opacity-50">
        Saved{" "}
        {state.at.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    );
  }

  return <span className="text-[11px] opacity-40">All changes saved</span>;
}
