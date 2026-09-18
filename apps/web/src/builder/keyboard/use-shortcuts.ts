"use client";

import { duplicateElements, type ZDirection } from "@formcraft/schema";
import { nanoid } from "nanoid";
import { useEffect } from "react";

import {
  deleteElementsCommand,
  insertElementsCommand,
  moveElementsCommand,
  reorderZCommand,
} from "../store/commands";
import { useBuilderStore } from "../store/use-builder";

/** Arrow key step, and the larger step with shift — Figma's 1 and 10. */
const NUDGE = 1;
const NUDGE_LARGE = 10;

/** Pasted and duplicated copies land slightly offset so they're visible. */
const PASTE_OFFSET = { dx: 10, dy: 10 };

const ARROWS: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
};

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
 * All of them go through the same commands the mouse uses, so a nudge is as
 * undoable as a drag — and consecutive nudges merge into one history entry
 * rather than twenty.
 */
export function useBuilderShortcuts(): void {
  const store = useBuilderStore();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;

      const mod = event.metaKey || event.ctrlKey;
      const key = event.key;
      const lower = key.toLowerCase();

      // --- history ---------------------------------------------------------
      if (mod && lower === "z") {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && lower === "y") {
        event.preventDefault();
        store.redo();
        return;
      }

      // --- zoom ------------------------------------------------------------
      if (mod && (key === "=" || key === "+")) {
        event.preventDefault();
        store.zoomBy(1);
        return;
      }
      if (mod && key === "-") {
        event.preventDefault();
        store.zoomBy(-1);
        return;
      }
      if (mod && key === "0") {
        event.preventDefault();
        store.setScale(1);
        return;
      }

      // --- selection -------------------------------------------------------
      if (mod && lower === "a") {
        event.preventDefault();
        store.selectAll();
        return;
      }
      if (key === "Escape") {
        store.clearSelection();
        return;
      }

      // --- clipboard -------------------------------------------------------
      if (mod && lower === "c") {
        store.copy();
        return;
      }
      if (mod && lower === "x") {
        const { selection, document } = store.getState();
        if (selection.length === 0) return;
        event.preventDefault();
        store.copy();
        store.dispatch(deleteElementsCommand(document, selection));
        store.clearSelection();
        return;
      }
      if (mod && lower === "v") {
        event.preventDefault();
        paste();
        return;
      }
      if (mod && lower === "d") {
        event.preventDefault();
        duplicate();
        return;
      }

      // --- z-order ---------------------------------------------------------
      if (mod && (key === "]" || key === "[")) {
        event.preventDefault();
        const forward = key === "]";
        const direction: ZDirection = event.shiftKey
          ? forward
            ? "front"
            : "back"
          : forward
            ? "forward"
            : "backward";
        restack(direction);
        return;
      }

      // --- delete ----------------------------------------------------------
      if (key === "Delete" || key === "Backspace") {
        const { selection, document } = store.getState();
        if (selection.length === 0) return;
        event.preventDefault();
        store.dispatch(deleteElementsCommand(document, selection));
        store.clearSelection();
        return;
      }

      // --- nudge -----------------------------------------------------------
      const arrow = ARROWS[key];
      if (arrow) {
        const { selection } = store.getState();
        if (selection.length === 0) return;
        event.preventDefault();

        const step = event.shiftKey ? NUDGE_LARGE : NUDGE;
        store.dispatch(
          moveElementsCommand(selection, arrow.dx * step, arrow.dy * step),
        );
      }
    }

    function restack(direction: ZDirection) {
      const { selection, document } = store.getState();
      if (selection.length === 0) return;
      store.dispatch(reorderZCommand(document, selection, direction));
    }

    function paste() {
      const { clipboard, activePageId } = store.getState();
      if (clipboard.length === 0) return;

      const copies = clipboard.map((element, index) => ({
        ...element,
        id: nanoid(),
        x: element.x + PASTE_OFFSET.dx,
        y: element.y + PASTE_OFFSET.dy,
        // Keep them above what is already there, in their original order.
        z: element.z + index,
      }));

      store.dispatch(insertElementsCommand(activePageId, copies, "Paste"));
      store.select(copies.map((element) => element.id));
      // Pasting again offsets from the copies, as in most editors.
      store.setClipboard(copies);
    }

    function duplicate() {
      const { selection, document, activePageId } = store.getState();
      if (selection.length === 0) return;

      const copies = duplicateElements(
        document,
        selection,
        selection.map(() => nanoid()),
        PASTE_OFFSET,
      );

      store.dispatch(insertElementsCommand(activePageId, copies, "Duplicate"));
      store.select(copies.map((element) => element.id));
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [store]);
}
