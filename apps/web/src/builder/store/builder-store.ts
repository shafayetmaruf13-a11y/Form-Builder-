import type { FormDocument } from "@formcraft/schema";

import { CommandStack } from "./command-stack";
import type { Command } from "./commands";

/** A live, uncommitted gesture. Never part of the document, never undoable. */
export interface DragState {
  readonly ids: readonly string[];
  /** Displacement in page units, applied as a CSS transform. */
  readonly offset: { readonly dx: number; readonly dy: number };
}

export interface BuilderState {
  readonly document: FormDocument;
  readonly selection: readonly string[];
  readonly activePageId: string;
  readonly drag: DragState | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
}

type Listener = () => void;

/**
 * The builder's state, outside React.
 *
 * Deliberately hand-rolled on `useSyncExternalStore` rather than reaching for a
 * state library. Two reasons. It is about eighty lines, so a dependency would
 * be buying very little. And the interesting behaviour here is the command
 * stack, which no store library provides — it would have to be written either
 * way.
 *
 * The critical property is **selector subscriptions**: a component can watch
 * one element and re-render only when that element changes. Combined with the
 * structural sharing the schema's operations guarantee, dragging one element
 * re-renders one element, not the page. Context alone would re-render every
 * consumer on every change, which is exactly the 60fps the quality bar asks
 * for, spent.
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
      drag: null,
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

  /** Mirrors the command stack's flags into state so the UI can subscribe. */
  private historyFlags() {
    return {
      canUndo: this.commands.canUndo,
      canRedo: this.commands.canRedo,
      undoLabel: this.commands.undoLabel,
      redoLabel: this.commands.redoLabel,
    };
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
   * Replaces the whole document and drops history.
   *
   * Used for loading a draft or the sample. History is cleared because undoing
   * *past* a document swap would resurrect edits that belong to a document the
   * user is no longer looking at.
   */
  replaceDocument(document: FormDocument): void {
    this.commands.clear();
    this.set({
      document,
      selection: [],
      activePageId: document.pages[0]?.id ?? "",
      drag: null,
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

  clearSelection(): void {
    this.select([]);
  }

  setActivePage(pageId: string): void {
    if (pageId === this.state.activePageId) return;
    this.set({ activePageId: pageId });
  }

  // -------------------------------------------------------------------------
  // Dragging
  // -------------------------------------------------------------------------

  /**
   * Updates the live gesture. Called on every pointer frame, and deliberately
   * touches nothing but `drag` — the document is written once, on commit.
   */
  setDrag(drag: DragState | null): void {
    if (drag === null && this.state.drag === null) return;
    this.set({ drag });
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
