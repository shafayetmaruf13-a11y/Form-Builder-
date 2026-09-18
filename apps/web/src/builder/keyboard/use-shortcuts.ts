"use client";

import { useEffect } from "react";

import { deleteElementsCommand } from "../store/commands";
import { useBuilderStore } from "../store/use-builder";

/** True when the user is typing, so the canvas must keep its hands off. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/**
 * Builder keyboard shortcuts, following Figma where they overlap.
 *
 * Slice 2a covers undo, redo, delete and deselect. Nudge, select-all, clipboard
 * and z-order arrive in 2b with the gestures they belong to.
 */
export function useBuilderShortcuts(): void {
  const store = useBuilderStore();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;

      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        // ⌘⇧Z redoes, matching Figma and most macOS apps.
        if (event.shiftKey) {
          store.redo();
        } else {
          store.undo();
        }
        return;
      }

      // ⌘Y is the Windows convention for redo; harmless to accept both.
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        store.redo();
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        const { selection, document } = store.getState();
        if (selection.length === 0) return;
        event.preventDefault();
        store.dispatch(deleteElementsCommand(document, selection));
        store.clearSelection();
        return;
      }

      if (event.key === "Escape") {
        store.clearSelection();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [store]);
}
