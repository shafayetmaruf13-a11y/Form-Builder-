import type { FormDocument, Page } from "./document";
import type { FormElement } from "./elements";

/**
 * Pure transforms over a form document.
 *
 * Every one returns a new document and never mutates its input. They live in
 * the schema package, beside the definition of a document, so the builder, the
 * API and any future server-side edit share one implementation rather than
 * three subtly different ones.
 *
 * **Structural sharing is a contract, not an optimisation.** An operation must
 * return the *same object reference* for anything it did not change — unchanged
 * elements, unchanged pages, and the document itself when nothing changed at
 * all. The builder store gives each element its own subscription and compares by
 * identity, so an operation that rebuilt every object would re-render the whole
 * canvas on every drag and cost exactly the 60fps the quality bar asks for.
 */

/** Where an element sits, captured so a delete can be undone precisely. */
export interface ElementLocation {
  pageId: string;
  /** Index within that page's element array. */
  index: number;
  element: FormElement;
}

function replacePage(
  document: FormDocument,
  pageId: string,
  update: (page: Page) => Page,
): FormDocument {
  let changed = false;

  const pages = document.pages.map((page) => {
    if (page.id !== pageId) return page;
    const next = update(page);
    if (next !== page) changed = true;
    return next;
  });

  return changed ? { ...document, pages } : document;
}

/** Appends an element to a page. Appending puts it on top in document order. */
export function addElement(
  document: FormDocument,
  pageId: string,
  element: FormElement,
): FormDocument {
  return replacePage(document, pageId, (page) => ({
    ...page,
    elements: [...page.elements, element],
  }));
}

/**
 * Inserts elements back at exact positions.
 *
 * Used to undo a delete. Insertion runs in ascending index order so that each
 * index means what it meant when the location was captured.
 */
export function restoreElements(
  document: FormDocument,
  locations: readonly ElementLocation[],
): FormDocument {
  if (locations.length === 0) return document;

  const byPage = new Map<string, ElementLocation[]>();
  for (const location of locations) {
    const list = byPage.get(location.pageId);
    if (list) {
      list.push(location);
    } else {
      byPage.set(location.pageId, [location]);
    }
  }

  let next = document;
  for (const [pageId, pageLocations] of byPage) {
    const ordered = [...pageLocations].sort((a, b) => a.index - b.index);
    next = replacePage(next, pageId, (page) => {
      const elements = [...page.elements];
      for (const location of ordered) {
        elements.splice(
          Math.min(location.index, elements.length),
          0,
          location.element,
        );
      }
      return { ...page, elements };
    });
  }

  return next;
}

/** Captures where the given elements currently live, for a later restore. */
export function elementLocations(
  document: FormDocument,
  ids: readonly string[],
): ElementLocation[] {
  const wanted = new Set(ids);
  const locations: ElementLocation[] = [];

  for (const page of document.pages) {
    page.elements.forEach((element, index) => {
      if (wanted.has(element.id)) {
        locations.push({ pageId: page.id, index, element });
      }
    });
  }

  return locations;
}

export function removeElements(
  document: FormDocument,
  ids: readonly string[],
): FormDocument {
  if (ids.length === 0) return document;
  const doomed = new Set(ids);
  let changed = false;

  const pages = document.pages.map((page) => {
    const elements = page.elements.filter((element) => !doomed.has(element.id));
    if (elements.length === page.elements.length) return page;
    changed = true;
    return { ...page, elements };
  });

  return changed ? { ...document, pages } : document;
}

/**
 * Moves elements by a delta in page units.
 *
 * Coordinates are not clamped to the page: an element may be dragged partly
 * off-canvas, and silently correcting a designer's position would be worse
 * than letting the renderer clip it.
 */
export function translateElements(
  document: FormDocument,
  ids: readonly string[],
  dx: number,
  dy: number,
): FormDocument {
  if (ids.length === 0 || (dx === 0 && dy === 0)) return document;
  const moving = new Set(ids);
  let changed = false;

  const pages = document.pages.map((page) => {
    let pageChanged = false;

    const elements = page.elements.map((element) => {
      if (!moving.has(element.id)) return element;
      pageChanged = true;
      return { ...element, x: element.x + dx, y: element.y + dy };
    });

    if (!pageChanged) return page;
    changed = true;
    return { ...page, elements };
  });

  return changed ? { ...document, pages } : document;
}

/** Finds an element anywhere in the document. */
export function findElement(
  document: FormDocument,
  id: string,
): FormElement | undefined {
  for (const page of document.pages) {
    const found = page.elements.find((element) => element.id === id);
    if (found) return found;
  }
  return undefined;
}

/** The id of the page holding an element, if any. */
export function pageIdOfElement(
  document: FormDocument,
  id: string,
): string | undefined {
  return document.pages.find((page) =>
    page.elements.some((element) => element.id === id),
  )?.id;
}
