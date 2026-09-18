import type { FormDocument, Page } from "./document";
import { type FormElement, elementSchema } from "./elements";

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

/**
 * Applies a partial change to one element, re-validating the result.
 *
 * The patch goes through `elementSchema.parse` rather than being trusted,
 * because the properties panel is a wall of free-text and numeric inputs and
 * architecture rule 1 says the schema decides what a valid element is. An
 * invalid patch leaves the document untouched instead of corrupting it — the
 * panel is expected to constrain its own inputs, so this is a backstop, not the
 * primary defence.
 */
export function updateElement(
  document: FormDocument,
  id: string,
  patch: Record<string, unknown>,
): FormDocument {
  const current = findElement(document, id);
  if (!current) return document;

  const parsed = elementSchema.safeParse({ ...current, ...patch });
  if (!parsed.success) return document;

  return replaceElement(document, id, parsed.data);
}

/** Replaces an element wholesale with one already known to be valid. */
export function replaceElement(
  document: FormDocument,
  id: string,
  element: FormElement,
): FormDocument {
  let changed = false;

  const pages = document.pages.map((page) => {
    let pageChanged = false;

    const elements = page.elements.map((candidate) => {
      if (candidate.id !== id) return candidate;
      pageChanged = true;
      return element;
    });

    if (!pageChanged) return page;
    changed = true;
    return { ...page, elements };
  });

  return changed ? { ...document, pages } : document;
}

/** Merges a style patch into an element's style block. */
export function updateElementStyle(
  document: FormDocument,
  id: string,
  patch: Record<string, unknown>,
): FormDocument {
  const current = findElement(document, id);
  if (!current) return document;

  return updateElement(document, id, {
    style: { ...current.style, ...patch },
  });
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** Inserts a page. A negative or oversized index appends. */
export function addPage(
  document: FormDocument,
  page: Page,
  index?: number,
): FormDocument {
  const pages = [...document.pages];
  const at =
    index === undefined
      ? pages.length
      : Math.max(0, Math.min(index, pages.length));
  pages.splice(at, 0, page);

  return { ...document, pages };
}

/**
 * Removes a page.
 *
 * The last page is never removed: `formDocumentSchema` requires at least one,
 * and a document with nothing to render is never what someone meant.
 */
export function removePage(
  document: FormDocument,
  pageId: string,
): FormDocument {
  if (document.pages.length <= 1) return document;

  const pages = document.pages.filter((page) => page.id !== pageId);
  return pages.length === document.pages.length
    ? document
    : { ...document, pages };
}

/** Moves a page to a new index. */
export function movePage(
  document: FormDocument,
  pageId: string,
  toIndex: number,
): FormDocument {
  const from = document.pages.findIndex((page) => page.id === pageId);
  if (from === -1) return document;

  const to = Math.max(0, Math.min(toIndex, document.pages.length - 1));
  if (from === to) return document;

  const pages = [...document.pages];
  const [moved] = pages.splice(from, 1);
  pages.splice(to, 0, moved!);

  return { ...document, pages };
}

/** Patches a page's own fields, e.g. its background colour. */
export function updatePage(
  document: FormDocument,
  pageId: string,
  patch: Partial<Omit<Page, "id" | "elements">>,
): FormDocument {
  return replacePage(document, pageId, (page) => ({ ...page, ...patch }));
}

/** The document's title. */
export function setTitle(document: FormDocument, title: string): FormDocument {
  return title === document.title ? document : { ...document, title };
}

/** Geometry an element can be moved, resized or rotated to. */
export interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

/** Sets one element's geometry outright. Used by resize and rotate. */
export function setElementGeometry(
  document: FormDocument,
  id: string,
  geometry: Geometry,
): FormDocument {
  let changed = false;

  const pages = document.pages.map((page) => {
    let pageChanged = false;

    const elements = page.elements.map((element) => {
      if (element.id !== id) return element;
      if (
        element.x === geometry.x &&
        element.y === geometry.y &&
        element.w === geometry.w &&
        element.h === geometry.h &&
        element.rotation === geometry.rotation
      ) {
        return element;
      }
      pageChanged = true;
      return { ...element, ...geometry };
    });

    if (!pageChanged) return page;
    changed = true;
    return { ...page, elements };
  });

  return changed ? { ...document, pages } : document;
}

export type ZDirection = "front" | "back" | "forward" | "backward";

/**
 * Restacks elements within their page.
 *
 * `z` is rewritten as a dense 0..n-1 sequence afterwards. Sparse or duplicate
 * z values render unpredictably — paint order would fall back to document
 * order for ties — so normalising keeps "what you see" and "what is stored"
 * the same thing. This rewrites every element on the page, which is fine:
 * restacking is a discrete action, not something that happens per frame.
 */
export function reorderZ(
  document: FormDocument,
  ids: readonly string[],
  direction: ZDirection,
): FormDocument {
  if (ids.length === 0) return document;
  const moving = new Set(ids);
  let changed = false;

  const pages = document.pages.map((page) => {
    if (!page.elements.some((element) => moving.has(element.id))) return page;

    // Current paint order: by z, ties broken by document order.
    const order = page.elements
      .map((element, index) => ({ element, index }))
      .sort((a, b) => a.element.z - b.element.z || a.index - b.index)
      .map((entry) => entry.element);

    const next = restack(order, moving, direction);
    if (next.every((element, index) => element === order[index])) return page;

    changed = true;
    return {
      ...page,
      elements: next.map((element, index) =>
        element.z === index ? element : { ...element, z: index },
      ),
    };
  });

  return changed ? { ...document, pages } : document;
}

function restack(
  order: readonly FormElement[],
  moving: ReadonlySet<string>,
  direction: ZDirection,
): FormElement[] {
  const selected = order.filter((element) => moving.has(element.id));
  const rest = order.filter((element) => !moving.has(element.id));

  if (direction === "front") return [...rest, ...selected];
  if (direction === "back") return [...selected, ...rest];

  const next = [...order];

  if (direction === "forward") {
    // Walk from the top so a contiguous block shifts as one and cannot
    // overtake itself.
    for (let i = next.length - 2; i >= 0; i--) {
      const current = next[i]!;
      const above = next[i + 1]!;
      if (moving.has(current.id) && !moving.has(above.id)) {
        next[i] = above;
        next[i + 1] = current;
      }
    }
    return next;
  }

  for (let i = 1; i < next.length; i++) {
    const current = next[i]!;
    const below = next[i - 1]!;
    if (moving.has(current.id) && !moving.has(below.id)) {
      next[i] = below;
      next[i - 1] = current;
    }
  }
  return next;
}

/**
 * Restores explicit z values.
 *
 * Undoing a restack cannot be "apply the opposite direction" — bring-to-front
 * has no single inverse move — so the command captures every z before the
 * change and puts them back through this.
 */
export function setZValues(
  document: FormDocument,
  zByElementId: ReadonlyMap<string, number>,
): FormDocument {
  if (zByElementId.size === 0) return document;
  let changed = false;

  const pages = document.pages.map((page) => {
    let pageChanged = false;

    const elements = page.elements.map((element) => {
      const z = zByElementId.get(element.id);
      if (z === undefined || z === element.z) return element;
      pageChanged = true;
      return { ...element, z };
    });

    if (!pageChanged) return page;
    changed = true;
    return { ...page, elements };
  });

  return changed ? { ...document, pages } : document;
}

/** Every element's current z, for a later `setZValues`. */
export function captureZValues(document: FormDocument): Map<string, number> {
  const map = new Map<string, number>();
  for (const page of document.pages) {
    for (const element of page.elements) map.set(element.id, element.z);
  }
  return map;
}

/** Appends elements to a page, e.g. a paste or a duplicate. */
export function insertElements(
  document: FormDocument,
  pageId: string,
  elements: readonly FormElement[],
): FormDocument {
  if (elements.length === 0) return document;

  return replacePage(document, pageId, (page) => ({
    ...page,
    elements: [...page.elements, ...elements],
  }));
}

/**
 * Copies elements with fresh ids, nudged by an offset.
 *
 * New ids are supplied rather than generated (architecture rule 3 wants
 * nanoids, but a function that mints its own is untestable). Ids are consumed
 * in the order the elements appear in the document, not the order the caller
 * listed them.
 */
export function duplicateElements(
  document: FormDocument,
  ids: readonly string[],
  newIds: readonly string[],
  offset: { dx: number; dy: number },
): FormElement[] {
  const wanted = new Set(ids);
  const source = document.pages.flatMap((page) =>
    page.elements.filter((element) => wanted.has(element.id)),
  );

  return source.map((element, index) => ({
    ...element,
    id: newIds[index] ?? `${element.id}_copy${index}`,
    x: element.x + offset.dx,
    y: element.y + offset.dy,
  }));
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
