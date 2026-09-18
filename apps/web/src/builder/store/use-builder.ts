"use client";

import { type FormElement, findElement } from "@formcraft/schema";
import { createContext, useContext, useSyncExternalStore } from "react";

import type { BuilderState, BuilderStore, DragState } from "./builder-store";

const BuilderStoreContext = createContext<BuilderStore | null>(null);

export const BuilderStoreProvider = BuilderStoreContext.Provider;

export function useBuilderStore(): BuilderStore {
  const store = useContext(BuilderStoreContext);
  if (!store) {
    throw new Error(
      "useBuilderStore must be used inside a BuilderStoreProvider",
    );
  }
  return store;
}

/**
 * Subscribes to a slice of builder state.
 *
 * **A selector must return a stable reference for unchanged state.** React
 * calls `getSnapshot` on every render and compares with `Object.is`; a selector
 * that builds a fresh object each call would loop forever. That is why every
 * selector below returns either a primitive or an object the store itself
 * holds — and why the schema's operations guarantee structural sharing.
 */
export function useBuilderSelector<T>(selector: (state: BuilderState) => T): T {
  const store = useBuilderStore();
  const snapshot = () => selector(store.getState());

  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}

export function useDocument() {
  return useBuilderSelector((state) => state.document);
}

export function useSelection(): readonly string[] {
  return useBuilderSelector((state) => state.selection);
}

export function useActivePageId(): string {
  return useBuilderSelector((state) => state.activePageId);
}

/**
 * One element, by id.
 *
 * Returns the very object stored in the document, so an element that did not
 * change compares equal and its component does not re-render.
 */
export function useElement(id: string): FormElement | undefined {
  return useBuilderSelector((state) => findElement(state.document, id));
}

export function useIsSelected(id: string): boolean {
  return useBuilderSelector((state) => state.selection.includes(id));
}

/**
 * The live drag displacement for one element, or null if it isn't moving.
 *
 * Every element runs this selector on every drag frame, but only the ones
 * actually being dragged see a changed value — the rest return null and React
 * skips them. That is what keeps a drag at one re-render per moving element
 * rather than one per element on the page.
 */
export function useDragOffset(id: string): DragState["offset"] | null {
  return useBuilderSelector((state) =>
    state.drag && state.drag.ids.includes(id) ? state.drag.offset : null,
  );
}

export function useHistoryState() {
  const canUndo = useBuilderSelector((state) => state.canUndo);
  const canRedo = useBuilderSelector((state) => state.canRedo);
  const undoLabel = useBuilderSelector((state) => state.undoLabel);
  const redoLabel = useBuilderSelector((state) => state.redoLabel);

  return { canUndo, canRedo, undoLabel, redoLabel };
}
