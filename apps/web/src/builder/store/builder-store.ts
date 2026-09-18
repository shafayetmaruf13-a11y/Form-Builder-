import type { FormDocument, FormElement, Geometry } from "@formcraft/schema";

import type { Guide } from "../geometry/snapping";
import type { Rect } from "../geometry/transform";
import { ZOOM_LEVELS } from "../geometry/viewport";
import { CommandStack } from "./command-stack";
import type { Command } from "./commands";

/**
 * A gesture in progress.
 *
 * One field rather than several, so a pointer frame produces exactly one state
 * update and one render pass. Never part of the document, never undoable — the
 * document is written once, when the gesture ends.
 */
export type Gesture =
  | {
      kind: "move";
      ids: readonly string[];
      offset: { dx: number; dy: number };
      guides: readonly Guide[];
    }
  | {
      kind: "transform";
      id: string;
      geometry: Geometry;
      guides: readonly Guide[];
    }
  | { kind: "marquee"; rect: Rect }
  | null;

export interface BuilderState {
  readonly document: FormDocument;
  readonly selection: readonly string[];
  readonly activePageId: string;
  readonly gesture: Gesture;
  readonly clipboard: readonly FormElement[];
  readonly scale: number;
  readonly snapEnabled: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
}

type Listener = () => void;

const NO_GUIDES: readonly Guide[] = [];

/**
 * The builder's state, outside React.
 *
 * Hand-rolled on `useSyncExternalStore` rather than a state library: it is
 * small, and the interesting part — the command stack — is not something a
 * store library provides. Selector subscriptions are the point, so that
 * dragging one element re-renders one element rather than the page.
 */
export class BuilderStore {
  private state: BuilderState;
  private readonly listeners = new Set<Listener>();
  private readonly commands = new CommandStack();

  constructor(document: FormDocument) {
    this.state = {
      document,
      selection: [],
      activePageId: document.pages[0]?.id ?? "",
      gesture: null,
      clipboard: [],
      scale: 1,
      snapEnabled: true,
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      redoLabel: null,
    };
  }

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): BuilderState => this.state;

  private set(patch: Partial<BuilderState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private historyFlags() {
    return {
      canUndo: this.commands.canUndo,
      canRedo: this.commands.canRedo,
      undoLabel: this.commands.undoLabel,
      redoLabel: this.commands.redoLabel,
    };
  }

  private get activePage() {
    return this.state.document.pages.find(
      (page) => page.id === this.state.activePageId,
    );
  }

  // -------------------------------------------------------------------------
  // Editing
  // -------------------------------------------------------------------------

  dispatch(command: Command): void {
    const document = this.commands.execute(this.state.document, command);
    this.set({ document, ...this.historyFlags() });
  }

  undo(): void {
    if (!this.commands.canUndo) return;
    const document = this.commands.undo(this.state.document);
    this.set({
      document,
      selection: pruneSelection(this.state.selection, document),
      ...this.historyFlags(),
    });
  }

  redo(): void {
    if (!this.commands.canRedo) return;
    const document = this.commands.redo(this.state.document);
    this.set({
      document,
      selection: pruneSelection(this.state.selection, document),
      ...this.historyFlags(),
    });
  }

  /**
   * Replaces the whole document and drops history. Undoing past a document
   * swap would resurrect edits belonging to a document nobody is looking at.
   */
  replaceDocument(document: FormDocument): void {
    this.commands.clear();
    this.set({
      document,
      selection: [],
      activePageId: document.pages[0]?.id ?? "",
      gesture: null,
      ...this.historyFlags(),
    });
  }

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  select(ids: readonly string[]): void {
    if (sameIds(ids, this.state.selection)) return;
    this.set({ selection: [...ids] });
  }

  /** Shift-click: adds an element to the selection, or removes it if present. */
  toggleSelection(id: string): void {
    const { selection } = this.state;
    this.select(
      selection.includes(id)
        ? selection.filter((candidate) => candidate !== id)
        : [...selection, id],
    );
  }

  selectAll(): void {
    this.select(this.activePage?.elements.map((element) => element.id) ?? []);
  }

  clearSelection(): void {
    this.select([]);
  }

  setActivePage(pageId: string): void {
    if (pageId === this.state.activePageId) return;
    this.set({ activePageId: pageId, selection: [] });
  }

  /** The selected elements, in document order. */
  selectedElements(): FormElement[] {
    const selected = new Set(this.state.selection);
    return (this.activePage?.elements ?? []).filter((element) =>
      selected.has(element.id),
    );
  }

  // -------------------------------------------------------------------------
  // Gestures
  // -------------------------------------------------------------------------

  setGesture(gesture: Gesture): void {
    if (gesture === null && this.state.gesture === null) return;
    this.set({ gesture });
  }

  setMove(
    ids: readonly string[],
    offset: { dx: number; dy: number },
    guides: readonly Guide[] = NO_GUIDES,
  ): void {
    this.setGesture({ kind: "move", ids, offset, guides });
  }

  setTransform(
    id: string,
    geometry: Geometry,
    guides: readonly Guide[] = NO_GUIDES,
  ): void {
    this.setGesture({ kind: "transform", id, geometry, guides });
  }

  setMarquee(rect: Rect | null): void {
    this.setGesture(rect ? { kind: "marquee", rect } : null);
  }

  // -------------------------------------------------------------------------
  // Clipboard
  // -------------------------------------------------------------------------

  /**
   * An in-memory clipboard, not the system one.
   *
   * The system clipboard would allow pasting between tabs, but needs async
   * permissions and a serialisation format that anything else could paste
   * into. Worth doing later; not worth blocking the gesture work on.
   */
  copy(): void {
    const elements = this.selectedElements();
    if (elements.length === 0) return;
    this.set({ clipboard: elements });
  }

  setClipboard(elements: readonly FormElement[]): void {
    this.set({ clipboard: elements });
  }

  // -------------------------------------------------------------------------
  // Viewport
  // -------------------------------------------------------------------------

  setScale(scale: number): void {
    const clamped = Math.min(
      ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!,
      Math.max(ZOOM_LEVELS[0]!, scale),
    );
    if (clamped === this.state.scale) return;
    this.set({ scale: clamped });
  }

  zoomBy(steps: number): void {
    const levels = [...ZOOM_LEVELS];
    // Snap to the nearest listed level first, so zooming from an arbitrary
    // fit-to-window scale lands on a predictable one.
    const nearest = levels.reduce((best, level) =>
      Math.abs(level - this.state.scale) < Math.abs(best - this.state.scale)
        ? level
        : best,
    );
    const index = levels.indexOf(nearest);
    this.setScale(
      levels[Math.min(levels.length - 1, Math.max(0, index + steps))]!,
    );
  }

  toggleSnap(): void {
    this.set({ snapEnabled: !this.state.snapEnabled });
  }
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** Drops ids that no longer exist, e.g. after undoing an add. */
function pruneSelection(
  selection: readonly string[],
  document: FormDocument,
): readonly string[] {
  if (selection.length === 0) return selection;

  const live = new Set(
    document.pages.flatMap((page) => page.elements.map((el) => el.id)),
  );
  const kept = selection.filter((id) => live.has(id));

  return kept.length === selection.length ? selection : kept;
}
