import {
  type ElementLocation,
  type FormDocument,
  type FormElement,
  addElement,
  elementLocations,
  removeElements,
  restoreElements,
  translateElements,
} from "@formcraft/schema";

/**
 * An undoable edit.
 *
 * Commands, not snapshots. A snapshot history keeps a whole copy of the
 * document per edit — for a canvas app that means megabytes of near-identical
 * JSON and no way to tell two edits apart. A command knows what it did, so it
 * inverts itself exactly, describes itself in the UI, and can merge with the
 * one before it.
 */
export interface Command {
  /** Shown in the UI, e.g. "Undo move". */
  readonly label: string;
  /**
   * Commands with the same non-null key, close together in time, collapse into
   * one history entry. Twenty arrow-key nudges should be one undo, not twenty.
   */
  readonly mergeKey: string | null;
  redo(document: FormDocument): FormDocument;
  undo(document: FormDocument): FormDocument;
  /**
   * Combines this command with a later one carrying the same merge key.
   * Returning null refuses the merge and both are kept separately.
   */
  merge?(next: Command): Command | null;
}

export function addElementCommand(
  pageId: string,
  element: FormElement,
): Command {
  return {
    label: "Add element",
    mergeKey: null,
    redo: (document) => addElement(document, pageId, element),
    undo: (document) => removeElements(document, [element.id]),
  };
}

/**
 * Deletes elements, remembering exactly where they were.
 *
 * Locations are captured when the command is *built*, from the document as it
 * stands then — which is why undoing a delete puts elements back at their
 * original indices instead of appending them to the end of the page.
 */
export function deleteElementsCommand(
  document: FormDocument,
  ids: readonly string[],
): Command {
  const locations: ElementLocation[] = elementLocations(document, ids);

  return {
    label: locations.length > 1 ? "Delete elements" : "Delete element",
    mergeKey: null,
    redo: (current) => removeElements(current, ids),
    undo: (current) => restoreElements(current, locations),
  };
}

/** A move, with its delta on the command so merging can read it directly. */
export interface MoveCommand extends Command {
  readonly kind: "move";
  readonly ids: readonly string[];
  readonly dx: number;
  readonly dy: number;
}

function isMoveCommand(command: Command): command is MoveCommand {
  return (command as Partial<MoveCommand>).kind === "move";
}

export function moveElementsCommand(
  ids: readonly string[],
  dx: number,
  dy: number,
): MoveCommand {
  // Keyed by the exact set being moved, so nudging A and then B stays two
  // history entries rather than collapsing into one.
  const mergeKey = `move:${[...ids].sort().join(",")}`;

  return {
    kind: "move",
    label: "Move",
    mergeKey,
    ids,
    dx,
    dy,
    redo: (document) => translateElements(document, ids, dx, dy),
    undo: (document) => translateElements(document, ids, -dx, -dy),
    merge(next) {
      if (!isMoveCommand(next) || next.mergeKey !== mergeKey) return null;
      // Translation composes, so the merged command is just the summed delta.
      return moveElementsCommand(ids, dx + next.dx, dy + next.dy);
    },
  };
}
