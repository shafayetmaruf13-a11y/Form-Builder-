import type { FormDocument } from "@formcraft/schema";

import type { Command } from "./commands";

/**
 * Consecutive mergeable commands within this window collapse into one history
 * entry. Long enough to absorb a burst of arrow-key nudges, short enough that a
 * deliberate second move stays separately undoable.
 */
export const MERGE_WINDOW_MS = 600;

interface Entry {
  command: Command;
  at: number;
}

/**
 * Undo/redo over a document.
 *
 * The stack owns no document of its own — every method takes the current one
 * and returns the next. That keeps it a pure, testable object and leaves the
 * store as the single place a document actually lives.
 */
export class CommandStack {
  private undoStack: Entry[] = [];
  private redoStack: Command[] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Label of the edit that undo would reverse, for the UI. */
  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.command.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  /** Number of history entries. Merging means this is not the edit count. */
  get depth(): number {
    return this.undoStack.length;
  }

  execute(
    document: FormDocument,
    command: Command,
    now: number = Date.now(),
  ): FormDocument {
    const next = command.redo(document);

    // Doing something new invalidates any future that was undone away.
    this.redoStack = [];

    const top = this.undoStack.at(-1);
    if (
      top &&
      command.mergeKey !== null &&
      top.command.mergeKey === command.mergeKey &&
      now - top.at <= MERGE_WINDOW_MS &&
      top.command.merge
    ) {
      const merged = top.command.merge(command);
      if (merged) {
        this.undoStack[this.undoStack.length - 1] = {
          command: merged,
          at: now,
        };
        return next;
      }
    }

    this.undoStack.push({ command, at: now });
    return next;
  }

  undo(document: FormDocument): FormDocument {
    const entry = this.undoStack.pop();
    if (!entry) return document;

    this.redoStack.push(entry.command);
    return entry.command.undo(document);
  }

  redo(document: FormDocument, now: number = Date.now()): FormDocument {
    const command = this.redoStack.pop();
    if (!command) return document;

    // Pushed with the current time so a redone command cannot then merge with
    // an unrelated edit that happens to follow it.
    this.undoStack.push({ command, at: now });
    return command.redo(document);
  }

  /** Drops all history. Used when a whole new document is loaded. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
