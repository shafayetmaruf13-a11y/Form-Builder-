"use client";

import { type FormDocument, formDocumentSchema } from "@formcraft/schema";
import { useEffect, useRef } from "react";

import type { BuilderStore } from "../store/builder-store";

const DRAFT_KEY = "formcraft:builder:draft";
const SAVE_DEBOUNCE_MS = 400;

/**
 * Keeps the in-progress document in localStorage.
 *
 * Real persistence is Slice 3's job — server-side drafts with autosave. This is
 * the stopgap that stops a refresh throwing your work away in the meantime,
 * because "nothing is ever lost" is in the quality bar and an unsaved canvas
 * fails it. Slice 3 replaces this wholesale.
 *
 * Loading happens in an effect rather than during render so the server and the
 * first client render agree; localStorage does not exist during SSR.
 */
export function useDraftPersistence(store: BuilderStore): void {
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    const draft = readDraft();
    if (draft) store.replaceDocument(draft);
  }, [store]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastSaved = store.getState().document;

    const unsubscribe = store.subscribe(() => {
      const { document } = store.getState();
      if (document === lastSaved) return;
      lastSaved = document;

      // Debounced: a drag commits one document, but a burst of edits should
      // not mean a burst of JSON serialisation on the main thread.
      clearTimeout(timer);
      timer = setTimeout(() => {
        writeDraft(document);
      }, SAVE_DEBOUNCE_MS);
    });

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [store]);
}

function readDraft(): FormDocument | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;

    // Validated, not trusted: a draft written by an older build of the app
    // could be any shape at all, and a bad one should be ignored rather than
    // crash the builder on load.
    const parsed = formDocumentSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeDraft(document: FormDocument): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(document));
  } catch {
    // Private mode, quota exceeded, storage disabled. Losing the draft is bad;
    // taking the builder down with it would be worse.
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // As above.
  }
}
