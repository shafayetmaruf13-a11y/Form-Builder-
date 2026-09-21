"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { publishForm } from "@/server/publish/actions";
import type { PublishProblem } from "@/server/publish/checks";

/**
 * Publishing, from the builder's toolbar.
 *
 * The draft is saved continuously, so publishing takes nothing from the client
 * — the server snapshots whatever it has stored. That also means the button
 * cannot publish a document the server has not seen, which is what makes the
 * snapshot trustworthy.
 */
export function PublishButton({
  formId,
  saving,
}: {
  formId: string;
  /** True while autosave is in flight — publishing now would miss the last edit. */
  saving: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | { kind: "published"; slug: string; version: number }
    | { kind: "problems"; problems: PublishProblem[] }
    | null
  >(null);

  return (
    <>
      <button
        type="button"
        disabled={pending || saving}
        title={
          saving
            ? "Waiting for the last change to save"
            : "Publish this form and get a share link"
        }
        onClick={() =>
          startTransition(async () => {
            const outcome = await publishForm(formId);
            setResult(
              outcome.ok
                ? {
                    kind: "published",
                    slug: outcome.slug,
                    version: outcome.version,
                  }
                : { kind: "problems", problems: outcome.problems },
            );
          })
        }
        className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {pending ? "Publishing…" : "Publish"}
      </button>

      {result && (
        <PublishDialog
          formId={formId}
          result={result}
          onClose={() => setResult(null)}
        />
      )}
    </>
  );
}

function PublishDialog({
  formId,
  result,
  onClose,
}: {
  formId: string;
  result:
    | { kind: "published"; slug: string; version: number }
    | { kind: "problems"; problems: PublishProblem[] };
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  // Built in the browser rather than on the server: the public origin is
  // whatever host the owner actually reached this page on, and guessing it
  // from an environment variable is how share links end up pointing at
  // localhost.
  const url =
    result.kind === "published"
      ? `${window.location.origin}/f/${result.slug}`
      : "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={
        result.kind === "published" ? "Form published" : "Cannot publish yet"
      }
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 text-sm shadow-xl dark:bg-neutral-900"
        onClick={(event) => event.stopPropagation()}
      >
        {result.kind === "published" ? (
          <>
            <h2 className="mb-1 text-base font-semibold">
              Published as version {result.version}
            </h2>
            <p className="mb-3 opacity-70">
              Anyone with this link can fill the form in. Editing the form from
              now on does not change what this link shows.
            </p>

            <div className="flex gap-2">
              <input
                readOnly
                value={url}
                aria-label="Share link"
                className="flex-1 rounded border border-black/10 bg-black/5 px-2 py-1 font-mono text-xs dark:border-white/15 dark:bg-white/10"
                onFocus={(event) => event.target.select()}
              />
              <button
                type="button"
                className="rounded bg-neutral-900 px-3 py-1 text-xs font-semibold text-white dark:bg-white dark:text-neutral-900"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                  } catch {
                    // Clipboard permission refused; the field is selectable.
                  }
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <Link
                href={`/forms/${formId}/responses`}
                className="text-xs underline opacity-80"
              >
                Manage links and responses
              </Link>
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-black/10 px-3 py-1 text-xs dark:border-white/15"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="mb-1 text-base font-semibold">
              This form isn&apos;t ready to publish
            </h2>
            <p className="mb-3 opacity-70">
              Once a version is published it cannot be changed, so these have to
              be fixed first.
            </p>

            <ul className="mb-4 list-disc space-y-1 pl-5">
              {result.problems.map((problem) => (
                <li key={problem.message}>{problem.message}</li>
              ))}
            </ul>

            <button
              type="button"
              onClick={onClose}
              className="rounded border border-black/10 px-3 py-1 text-xs dark:border-white/15"
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}
