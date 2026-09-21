"use client";

import type { FormDocument } from "@formcraft/schema";
import { useEffect, useRef, useState } from "react";

import type { BuilderStore } from "../store/builder-store";

/** How long the document must sit still before a save goes out. */
const DEBOUNCE_MS = 800;

export type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; at: Date }
  | { status: "error"; message: string }
  | { status: "conflict" };

/**
 * Keeps the server's copy of the draft up to date.
 *
 * Deliberately *not* mirrored to localStorage. The builder store is the truth
 * while the tab is open and the server is the truth between sessions; a third
 * copy that can disagree with both on load is a worse bug than the one it would
 * prevent. Offline buffering is a real feature and deserves its own design.
 *
 * On failure the caller shows a persistent error and `beforeunload` warns —
 * losing work quietly is what "nothing is ever lost" is actually about.
 */
export function useAutosave(
  store: BuilderStore,
  formId: string,
  initialUpdatedAt: string,
): SaveState {
  const [state, setState] = useState<SaveState>({ status: "idle" });

  // Refs, not state: these change on every keystroke and nothing renders from
  // them directly.
  const expectedUpdatedAt = useRef(initialUpdatedAt);
  const pending = useRef<FormDocument | null>(null);
  const inFlight = useRef(false);
  const lastSaved = useRef<FormDocument>(store.getState().document);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    async function flush({ keepalive = false } = {}) {
      const draft = pending.current;
      if (!draft || inFlight.current) return;

      inFlight.current = true;
      pending.current = null;
      if (!cancelled) setState({ status: "saving" });

      try {
        const response = await fetch(`/api/forms/${formId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          // Survives the page going away. Capped at ~64KB by the browser, so
          // it is a best effort on unload, not the primary mechanism.
          keepalive,
          body: JSON.stringify({
            document: draft,
            expectedUpdatedAt: expectedUpdatedAt.current,
          }),
        });

        if (response.status === 409) {
          if (!cancelled) setState({ status: "conflict" });
          // Deliberately not retried: another tab owns the row now, and
          // hammering it would be the silent overwrite this check exists to
          // prevent.
          return;
        }

        if (!response.ok) {
          const body: unknown = await response.json().catch(() => null);
          const message =
            body &&
            typeof body === "object" &&
            "error" in body &&
            typeof body.error === "string"
              ? body.error
              : `Save failed (${response.status})`;
          if (!cancelled) setState({ status: "error", message });
          return;
        }

        const body: unknown = await response.json().catch(() => null);
        if (
          body &&
          typeof body === "object" &&
          "updatedAt" in body &&
          typeof body.updatedAt === "string"
        ) {
          expectedUpdatedAt.current = body.updatedAt;
        }

        lastSaved.current = draft;
        if (!cancelled) setState({ status: "saved", at: new Date() });
      } catch {
        if (!cancelled) {
          setState({ status: "error", message: "Could not reach the server" });
        }
      } finally {
        inFlight.current = false;
        // A change that arrived mid-flight still needs saving.
        if (pending.current && !cancelled) void flush();
      }
    }

    const unsubscribe = store.subscribe(() => {
      const current = store.getState().document;
      if (current === lastSaved.current) return;

      pending.current = current;
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), DEBOUNCE_MS);
    });

    /**
     * Leaving with unsaved work: try to get it out, and warn either way.
     *
     * `sendBeacon` is the usual tool here but it can only POST, and this
     * endpoint is a PATCH; a keepalive fetch keeps the right method.
     */
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!pending.current && !inFlight.current) return;
      if (pending.current) void flush({ keepalive: true });
      event.preventDefault();
    }

    // The reliable one. `beforeunload` is increasingly unreliable on mobile,
    // where a backgrounded tab may simply never come back.
    function onVisibilityChange() {
      if (window.document.visibilityState === "hidden" && pending.current) {
        clearTimeout(timer);
        void flush({ keepalive: true });
      }
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    window.document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.document.removeEventListener(
        "visibilitychange",
        onVisibilityChange,
      );
    };
  }, [store, formId]);

  return state;
}
