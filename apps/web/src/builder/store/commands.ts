import {
  type ElementLocation,
  type FormDocument,
  type FormElement,
  type Geometry,
  type Page,
  type ZDirection,
  addElement,
  addPage,
  captureZValues,
  elementLocations,
  insertElements,
  movePage,
  removeElements,
  removePage,
  reorderZ,
  replaceElement,
  restoreElements,
  setElementGeometry,
  setTitle,
  setZValues,
  translateElements,
  updatePage,
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

/**
 * Sets one element's geometry, for a resize or a rotate.
 *
 * Both the before and after are passed in rather than read from the document,
 * because the gesture already knows where it started — and reading "before"
 * at commit time would capture the geometry *after* the change on a redo.
 */
export function setGeometryCommand(
  id: string,
  before: Geometry,
  after: Geometry,
  label = "Resize",
): Command {
  return {
    label,
    // Resizes commit once per gesture, so there is nothing to merge.
    mergeKey: null,
    redo: (document) => setElementGeometry(document, id, after),
    undo: (document) => setElementGeometry(document, id, before),
  };
}

/**
 * Restacks elements.
 *
 * Undo restores every z value captured beforehand rather than applying an
 * opposite direction — "bring to front" has no single inverse move, and after
 * normalisation the old values are the only faithful record of what the
 * stacking was.
 */
export function reorderZCommand(
  document: FormDocument,
  ids: readonly string[],
  direction: ZDirection,
): Command {
  const before = captureZValues(document);

  const labels: Record<ZDirection, string> = {
    front: "Bring to front",
    back: "Send to back",
    forward: "Bring forward",
    backward: "Send backward",
  };

  return {
    label: labels[direction],
    mergeKey: null,
    redo: (current) => reorderZ(current, ids, direction),
    undo: (current) => setZValues(current, before),
  };
}

/**
 * Replaces one element, for a properties-panel edit.
 *
 * Merges with later edits to the same element, so typing a label is one undo
 * rather than one per keystroke. The merge keeps the *original* before-state
 * and takes the latest after-state, which is what makes a burst of edits
 * collapse into a single reversible step.
 */
export interface UpdateElementCommand extends Command {
  readonly kind: "updateElement";
  readonly id: string;
  readonly before: FormElement;
  readonly after: FormElement;
}

function isUpdateElementCommand(
  command: Command,
): command is UpdateElementCommand {
  return (command as Partial<UpdateElementCommand>).kind === "updateElement";
}

export function updateElementCommand(
  id: string,
  before: FormElement,
  after: FormElement,
  label = "Edit",
): UpdateElementCommand {
  return {
    kind: "updateElement",
    label,
    mergeKey: `update:${id}`,
    id,
    before,
    after,
    redo: (document) => replaceElement(document, id, after),
    undo: (document) => replaceElement(document, id, before),
    merge(next) {
      if (!isUpdateElementCommand(next) || next.id !== id) return null;
      return updateElementCommand(id, before, next.after, next.label);
    },
  };
}

export function addPageCommand(page: Page, index?: number): Command {
  return {
    label: "Add page",
    mergeKey: null,
    redo: (document) => addPage(document, page, index),
    undo: (document) => removePage(document, page.id),
  };
}

/**
 * Deletes a page, remembering the page itself and where it sat, so undo puts
 * back both its contents and its position.
 */
export function removePageCommand(
  document: FormDocument,
  pageId: string,
): Command | null {
  const index = document.pages.findIndex((page) => page.id === pageId);
  const page = document.pages[index];
  // The schema requires at least one page, so this is not an offer we make.
  if (!page || document.pages.length <= 1) return null;

  return {
    label: "Delete page",
    mergeKey: null,
    redo: (current) => removePage(current, pageId),
    undo: (current) => addPage(current, page, index),
  };
}

export function movePageCommand(
  document: FormDocument,
  pageId: string,
  toIndex: number,
): Command {
  const from = document.pages.findIndex((page) => page.id === pageId);

  return {
    label: "Reorder pages",
    mergeKey: null,
    redo: (current) => movePage(current, pageId, toIndex),
    undo: (current) => movePage(current, pageId, from),
  };
}

export function updatePageCommand(
  pageId: string,
  before: Partial<Page>,
  after: Partial<Page>,
): Command {
  return {
    label: "Edit page",
    mergeKey: `page:${pageId}`,
    redo: (document) => updatePage(document, pageId, after),
    undo: (document) => updatePage(document, pageId, before),
  };
}

export function setTitleCommand(before: string, after: string): Command {
  return {
    label: "Rename form",
    mergeKey: "title",
    redo: (document) => setTitle(document, after),
    undo: (document) => setTitle(document, before),
  };
}

/** Adds elements to a page, for paste and duplicate. */
export function insertElementsCommand(
  pageId: string,
  elements: readonly FormElement[],
  label: string,
): Command {
  const ids = elements.map((element) => element.id);

  return {
    label,
    mergeKey: null,
    redo: (document) => insertElements(document, pageId, elements),
    undo: (document) => removeElements(document, ids),
  };
}
