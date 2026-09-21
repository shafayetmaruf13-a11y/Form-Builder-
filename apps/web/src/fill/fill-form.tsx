"use client";

import {
  PAGE_WIDTH,
  type Answer,
  type Answers,
  type FormDocument,
  type FormElement,
  emptyAnswers,
  isInputElement,
  resolveVisibility,
  validateAnswers,
} from "@formcraft/schema";
import { useEffect, useMemo, useRef, useState } from "react";

import { ElementFrame } from "@/components/renderer/element-frame";
import { ElementView } from "@/components/renderer/element-view";
import { PageSurface } from "@/components/renderer/page-surface";
import { objectUrl } from "@/lib/storage/url";

import { LiveField } from "./live-field";
import {
  clearIdempotencyKey,
  useFillDraft,
  useIdempotencyKey,
} from "./use-fill-draft";

/**
 * A live form, filled in at the coordinates it was designed at.
 *
 * Renders through the same `PageSurface` the builder and the PDF use, passing a
 * `renderElement` that swaps input elements for real controls. Static elements
 * still go through `ElementView`, so a logo on a fill page is the same logo the
 * designer placed — there is one layout path (architecture rule 2), and this is
 * a second *set of leaves*, not a second tree.
 */

export interface FillFormProps {
  slug: string;
  document: FormDocument;
  version: number;
  token?: string;
  turnstileSiteKey: string | null;
}

type Status =
  | { kind: "filling" }
  | { kind: "submitting" }
  | { kind: "done"; id: string | null }
  | { kind: "failed"; message: string };

export function FillForm({
  slug,
  document,
  version,
  token,
  turnstileSiteKey,
}: FillFormProps) {
  const [answers, setAnswers] = useState<Answers>(() => emptyAnswers(document));
  const [showErrors, setShowErrors] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "filling" });
  const [scale, setScale] = useState(1);

  const draft = useFillDraft(slug, version);
  const idempotencyKey = useIdempotencyKey(slug);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);

  // Restores a previous visit's answers the moment they become available.
  //
  // Adjusted during render rather than in an effect — React's documented
  // pattern for "state derived from something that just changed". An effect
  // would paint an empty form first and then replace it, which is exactly the
  // flash of lost work this feature exists to prevent.
  const [mergedDraft, setMergedDraft] = useState<Answers | null>(null);
  if (draft.restored && draft.restored !== mergedDraft) {
    const restored = draft.restored;
    setMergedDraft(restored);
    setAnswers((current) => ({ ...current, ...restored }));
  }

  /**
   * Fits the A4 page to the viewport.
   *
   * The page is a fixed 794 units wide by definition, so on a phone it must be
   * scaled rather than reflowed — reflowing would be the second layout system
   * rule 2 forbids, and the result would no longer match the PDF.
   */
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const fit = () => {
      const available = element.clientWidth;
      setScale(Math.min(1, available / PAGE_WIDTH));
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Conditional logic, recomputed from the answers rather than stored. There is
  // no "is this shown" flag anywhere that could disagree with the rules.
  const visibility = useMemo(
    () => resolveVisibility(document, answers),
    [document, answers],
  );

  // The same function the server will run (rule 5). This one is for the person
  // filling in; the server's is the one that counts.
  const validation = useMemo(
    () => validateAnswers(document, answers),
    [document, answers],
  );

  const errorsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const error of validation.errors)
      map.set(error.elementId, error.message);
    return map;
  }, [validation.errors]);

  function update(elementId: string, value: Answer) {
    setAnswers((current) => {
      const next = { ...current, [elementId]: value };
      draft.save(next);
      return next;
    });
  }

  async function submit() {
    setShowErrors(true);

    if (!validation.ok) {
      // Focus goes to the summary, which lists every problem as a link. WCAG
      // 3.3.1: an error has to be identified in text and reachable, not just
      // painted red somewhere down the page.
      summaryRef.current?.focus();
      return;
    }

    setStatus({ kind: "submitting" });

    const turnstileToken = turnstileSiteKey
      ? ((
          globalThis as { turnstile?: { getResponse: () => string } }
        ).turnstile?.getResponse() ?? undefined)
      : undefined;

    try {
      const response = await fetch(
        `/api/f/${encodeURIComponent(slug)}/submit`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            // Sent unpruned; the server decides what counts, and sending only
            // what this client thinks is visible would let a tampered client
            // choose which required fields exist.
            answers,
            idempotencyKey,
            turnstileToken,
            token,
          }),
        },
      );

      const result = (await response.json().catch(() => null)) as {
        id?: string;
        error?: string;
      } | null;

      if (!response.ok) {
        setStatus({
          kind: "failed",
          message:
            result?.error ??
            "Something went wrong sending this form. Please try again.",
        });
        return;
      }

      // Cleared only now: until the server has it, the draft is the only copy.
      draft.clear();
      clearIdempotencyKey(slug);
      setStatus({ kind: "done", id: result?.id ?? null });
    } catch {
      setStatus({
        kind: "failed",
        message:
          "Could not reach the server. Your answers are saved on this device — try again.",
      });
    }
  }

  if (status.kind === "done") {
    return <ThankYou title={document.title} />;
  }

  const visibleErrors = showErrors ? validation.errors : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {visibleErrors.length > 0 && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          style={{
            border: "2px solid #b91c1c",
            background: "#fef2f2",
            borderRadius: 8,
            padding: 16,
          }}
        >
          <h2 style={{ margin: "0 0 8px", fontSize: 16, color: "#7f1d1d" }}>
            {visibleErrors.length === 1
              ? "There is one problem to fix"
              : `There are ${visibleErrors.length} problems to fix`}
          </h2>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {visibleErrors.map((error) => (
              <li key={error.elementId}>
                <a
                  href={`#${error.elementId}-control`}
                  style={{ color: "#7f1d1d" }}
                >
                  {labelOf(document, error.elementId)}: {error.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div ref={containerRef} style={{ width: "100%" }}>
        {document.pages.map((page) => (
          <div key={page.id} style={{ marginBottom: 24 }}>
            <PageSurface
              page={page}
              scale={scale}
              imageSrc={objectUrl}
              renderElement={(element) => (
                <FillElement
                  key={element.id}
                  element={element}
                  visible={visibility.visible.has(element.id)}
                  value={answers[element.id]}
                  error={errorsById.get(element.id)}
                  showError={showErrors}
                  disabled={status.kind === "submitting"}
                  onChange={(value) => update(element.id, value)}
                />
              )}
            />
          </div>
        ))}
      </div>

      {turnstileSiteKey && (
        <div
          className="cf-turnstile"
          data-sitekey={turnstileSiteKey}
          style={{ alignSelf: "center" }}
        />
      )}

      {status.kind === "failed" && (
        <p role="alert" style={{ color: "#b91c1c", margin: 0 }}>
          {status.message}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={status.kind === "submitting"}
        style={{
          alignSelf: "flex-start",
          padding: "12px 24px",
          fontSize: 16,
          fontWeight: 600,
          minHeight: 44,
          borderRadius: 8,
          border: 0,
          background: status.kind === "submitting" ? "#94a3b8" : "#0f172a",
          color: "#ffffff",
          cursor: status.kind === "submitting" ? "default" : "pointer",
        }}
      >
        {status.kind === "submitting" ? "Sending…" : "Submit"}
      </button>
    </div>
  );
}

/**
 * One element on a fill page.
 *
 * A hidden element is removed from the DOM rather than hidden with CSS: a
 * `display: none` field is still submitted by some browsers and still reachable
 * by a screen reader in others, and rule 5's server-side prune would drop the
 * answer anyway. Removing it is the only version where what is asked, what is
 * announced and what is stored all agree.
 */
function FillElement({
  element,
  visible,
  value,
  error,
  showError,
  disabled,
  onChange,
}: {
  element: FormElement;
  visible: boolean;
  value: Answer | undefined;
  error: string | undefined;
  showError: boolean;
  disabled: boolean;
  onChange: (value: Answer) => void;
}) {
  if (!visible) return null;

  if (!isInputElement(element)) {
    return <ElementView element={element} imageSrc={objectUrl} />;
  }

  return (
    <ElementFrame element={element}>
      <LiveField
        element={element}
        value={value}
        onChange={onChange}
        error={error}
        showError={showError}
        disabled={disabled}
      />
    </ElementFrame>
  );
}

function ThankYou({ title }: { title: string }) {
  return (
    <div
      role="status"
      style={{
        border: "1px solid #bbf7d0",
        background: "#f0fdf4",
        borderRadius: 12,
        padding: 32,
        textAlign: "center",
      }}
    >
      <h1 style={{ margin: "0 0 8px", fontSize: 22 }}>Thank you</h1>
      <p style={{ margin: 0, color: "#166534" }}>
        Your response to &ldquo;{title}&rdquo; has been recorded. You can close
        this page.
      </p>
    </div>
  );
}

function labelOf(document: FormDocument, elementId: string): string {
  for (const page of document.pages) {
    for (const element of page.elements) {
      if (element.id === elementId && isInputElement(element)) {
        return element.label || "This field";
      }
    }
  }
  return "This field";
}
