"use client";

import type { Answers } from "@formcraft/schema";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * Keeping what somebody typed, across a refresh.
 *
 * The quality bar says nothing is ever lost, and a half-filled form closed by a
 * flat battery is the most ordinary way to lose something in this app. The
 * draft lives in `localStorage` keyed by link slug.
 *
 * Deliberately *not* on the server: that would mean an unauthenticated write
 * endpoint holding partial answers for anybody who opens a link — a spam
 * target, and personal data nobody consented to store. The trade is that a
 * draft does not follow somebody to another device, which for a form you fill
 * in one sitting is the right side of the bargain.
 *
 * Cleared on a successful submit, so a shared computer does not show the next
 * person what the last one wrote.
 */

const PREFIX = "formcraft:fill:";
/** Drafts older than this are ignored and swept. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

interface StoredDraft {
  savedAt: number;
  version: number;
  answers: Answers;
}

export interface FillDraft {
  /** Answers restored from a previous visit, or null if there were none. */
  restored: Answers | null;
  save: (answers: Answers) => void;
  clear: () => void;
}

/** Reads and validates a stored draft. Returns null for anything unusable. */
function readDraft(key: string, version: number): Answers | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;

    const draft = JSON.parse(raw) as StoredDraft;

    // A draft against an older published version is not restorable: element
    // ids may mean something different now, and rule 4 says a submission
    // belongs to exactly one version.
    if (draft.version !== version) {
      window.localStorage.removeItem(key);
      return null;
    }
    if (Date.now() - draft.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(key);
      return null;
    }

    return draft.answers;
  } catch {
    // Private browsing, a full quota, or a draft written by an older build.
    // None of these is worth failing the page over.
    return null;
  }
}

/** localStorage never changes under us here, so nothing to subscribe to. */
function subscribe(): () => void {
  return () => {};
}

/** The server has no localStorage, so it has no draft. */
function serverSnapshot(): Answers | null {
  return null;
}

export function useFillDraft(slug: string, version: number): FillDraft {
  const key = `${PREFIX}${slug}`;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `useSyncExternalStore` rather than an effect: reading localStorage *is*
  // reading an external store, and this is the one hook that gets the
  // server/hydration boundary right — the server renders with no draft, and
  // React re-reads on the client once it is safe to.
  //
  // The snapshot is cached because React calls it on every render and compares
  // by identity. Returning a freshly parsed object each time is an infinite
  // render loop.
  const cache = useRef<{ key: string; value: Answers | null } | null>(null);

  const getSnapshot = useCallback((): Answers | null => {
    if (cache.current?.key === key) return cache.current.value;

    const value = readDraft(key, version);
    cache.current = { key, value };
    return value;
  }, [key, version]);

  const restored = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);

  const save = useCallback(
    (answers: Answers) => {
      // Debounced: this runs on every keystroke, and `localStorage` is
      // synchronous and blocks the main thread.
      if (timer.current) clearTimeout(timer.current);

      timer.current = setTimeout(() => {
        try {
          const draft: StoredDraft = {
            savedAt: Date.now(),
            version,
            answers,
          };
          window.localStorage.setItem(key, JSON.stringify(draft));
        } catch {
          // Over quota — most likely a large signature. Losing the draft is
          // survivable; throwing here would not be.
        }
      }, 400);
    },
    [key, version],
  );

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    // The cache must go too, or a remount would restore what was just cleared.
    cache.current = { key, value: null };
    try {
      window.localStorage.removeItem(key);
    } catch {
      // As above.
    }
  }, [key]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return { restored, save, clear };
}

/** A stable key for one attempt at filling this form. */
export function useIdempotencyKey(slug: string): string {
  const [key] = useState(() => {
    // Survives a retry after a failed submit, including one caused by a
    // reload, so a lost response never becomes a duplicate row.
    const storageKey = `${PREFIX}${slug}:attempt`;

    try {
      const existing = window.localStorage.getItem(storageKey);
      if (existing) return existing;

      const fresh = crypto.randomUUID();
      window.localStorage.setItem(storageKey, fresh);
      return fresh;
    } catch {
      return crypto.randomUUID();
    }
  });

  return key;
}

/** Forgets the attempt key, so the next fill is a new submission. */
export function clearIdempotencyKey(slug: string): void {
  try {
    window.localStorage.removeItem(`${PREFIX}${slug}:attempt`);
  } catch {
    // Nothing to do.
  }
}
