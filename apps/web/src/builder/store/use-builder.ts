"use client";

import {
  type FormElement,
  type Geometry,
  findElement,
} from "@formcraft/schema";
import { createContext, useContext, useSyncExternalStore } from "react";

import type { Guide } from "../geometry/snapping";
import type { Rect } from "../geometry/transform";
import type { BuilderState, BuilderStore } from "./builder-store";

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

/** Stable empty array, so "no guides" is always the same reference. */
const NO_GUIDES: readonly Guide[] = [];

/**
 * Subscribes to a slice of builder state.
 *
 * **A selector must return a stable reference for unchanged state.** React
 * calls `getSnapshot` on every render and compares with `Object.is`; a selector
 * building a fresh object each call would loop forever. Every selector below
 * returns a primitive, or an object the store itself holds — which is also why
 * the schema's operations guarantee structural sharing.
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

export function useScale(): number {
  return useBuilderSelector((state) => state.scale);
}

export function useSnapEnabled(): boolean {
  return useBuilderSelector((state) => state.snapEnabled);
}

export function useClipboardCount(): number {
  return useBuilderSelector((state) => state.clipboard.length);
}

/**
 * One element, by id. Returns the very object in the document, so an element
 * that did not change compares equal and its component does not re-render.
 */
export function useElement(id: string): FormElement | undefined {
  return useBuilderSelector((state) => findElement(state.document, id));
}

export function useIsSelected(id: string): boolean {
  return useBuilderSelector((state) => state.selection.includes(id));
}

/**
 * The live move displacement for one element, or null if it isn't moving.
 *
 * Every element runs this on every frame, but only the ones actually moving
 * see a changed value; the rest return null and React skips them.
 */
export function useDragOffset(id: string): { dx: number; dy: number } | null {
  return useBuilderSelector((state) =>
    state.gesture?.kind === "move" && state.gesture.ids.includes(id)
      ? state.gesture.offset
      : null,
  );
}

/** Live geometry during a resize or rotate, or null. */
export function useTransformGeometry(id: string): Geometry | null {
  return useBuilderSelector((state) =>
    state.gesture?.kind === "transform" && state.gesture.id === id
      ? state.gesture.geometry
      : null,
  );
}

export function useGuides(): readonly Guide[] {
  return useBuilderSelector((state) =>
    state.gesture?.kind === "move" || state.gesture?.kind === "transform"
      ? state.gesture.guides
      : NO_GUIDES,
  );
}

export function useMarquee(): Rect | null {
  return useBuilderSelector((state) =>
    state.gesture?.kind === "marquee" ? state.gesture.rect : null,
  );
}

/** True while any gesture is running; used to hide chrome mid-drag. */
export function useIsGesturing(): boolean {
  return useBuilderSelector((state) => state.gesture !== null);
}

export function useHistoryState() {
  const canUndo = useBuilderSelector((state) => state.canUndo);
  const canRedo = useBuilderSelector((state) => state.canRedo);
  const undoLabel = useBuilderSelector((state) => state.undoLabel);
  const redoLabel = useBuilderSelector((state) => state.redoLabel);

  return { canUndo, canRedo, undoLabel, redoLabel };
}
