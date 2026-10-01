"use client";

import { useState, useTransition } from "react";

import { emailSubmission, setNotifyOnSubmission } from "@/server/email/actions";

/**
 * The owner's side of email.
 *
 * Two controls: whether this form notifies on submission, and sending one
 * response to somebody. Both call server actions that re-check permission —
 * a server action is a public endpoint, so the UI's state is a courtesy.
 */

export function NotifyToggle({
  formId,
  initial,
}: {
  formId: string;
  initial: boolean;
}) {
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs opacity-80">
      <input
        type="checkbox"
        checked={on}
        disabled={pending}
        className="h-4 w-4"
        onChange={(event) => {
          const next = event.target.checked;
          // Set straight away so the control does not feel stuck; the action
          // is the one that counts, and the page revalidates after it.
          setOn(next);
          startTransition(() => setNotifyOnSubmission(formId, next));
        }}
      />
      Email me each new response
    </label>
  );
}

export function EmailSubmissionButton({
  submissionId,
}: {
  submissionId: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="underline opacity-70 hover:opacity-100"
      >
        Email
      </button>

      {open && (
        <EmailDialog
          submissionId={submissionId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function EmailDialog({
  submissionId,
  onClose,
}: {
  submissionId: string;
  onClose: () => void;
}) {
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    { ok: true; delivered: string } | { ok: false; error: string } | null
  >(null);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Email this response"
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 text-left"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 text-sm shadow-xl dark:bg-neutral-900"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-1 text-base font-semibold">Email this response</h2>
        <p className="mb-4 opacity-70">
          The response is attached as a PDF. Replies go to your address, not to
          Formcraft.
        </p>

        <label className="mb-1 block text-xs font-medium" htmlFor="email-to">
          Send to
        </label>
        <input
          id="email-to"
          type="email"
          value={to}
          autoFocus
          placeholder="colleague@example.com"
          onChange={(event) => setTo(event.target.value)}
          className="mb-3 w-full rounded border border-black/10 px-2 py-1.5 dark:border-white/15 dark:bg-neutral-800"
        />

        <label className="mb-1 block text-xs font-medium" htmlFor="email-note">
          Note (optional)
        </label>
        <textarea
          id="email-note"
          value={note}
          rows={3}
          onChange={(event) => setNote(event.target.value)}
          className="mb-3 w-full rounded border border-black/10 px-2 py-1.5 dark:border-white/15 dark:bg-neutral-800"
        />

        {result && (
          <p
            role="status"
            className={`mb-3 text-xs ${result.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}
          >
            {result.ok
              ? result.delivered === "logged"
                ? "No email service is configured, so the message was written to the server log instead."
                : "Sent."
              : result.error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-black/10 px-3 py-1 text-xs dark:border-white/15"
          >
            Close
          </button>
          <button
            type="button"
            disabled={pending || to.trim() === ""}
            onClick={() =>
              startTransition(async () => {
                setResult(await emailSubmission(submissionId, to, note));
              })
            }
            className="rounded bg-neutral-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {pending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
