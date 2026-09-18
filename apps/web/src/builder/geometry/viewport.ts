/**
 * Screen pixels ↔ page units.
 *
 * Architecture rule 2 fixes one coordinate system for *output*. The builder is
 * the only place that needs the inverse — turning a pointer position back into
 * page units — and this is the only file allowed to do it. Anything else
 * converting coordinates by hand is how a second layout system gets in.
 */

export interface Point {
  x: number;
  y: number;
}

/** The page's on-screen box, as `getBoundingClientRect()` reports it. */
export interface PageRect {
  left: number;
  top: number;
}

/** Zoom levels offered by the toolbar. Slice 2b wires the UI; 2a renders at 1. */
export const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const;

export const DEFAULT_SCALE = 1;

/** A client point (e.g. `event.clientX/Y`) in page units. */
export function screenToPage(
  point: Point,
  pageRect: PageRect,
  scale: number,
): Point {
  return {
    x: (point.x - pageRect.left) / scale,
    y: (point.y - pageRect.top) / scale,
  };
}

/** A page-unit point as a client point. */
export function pageToScreen(
  point: Point,
  pageRect: PageRect,
  scale: number,
): Point {
  return {
    x: point.x * scale + pageRect.left,
    y: point.y * scale + pageRect.top,
  };
}

/**
 * A screen-space displacement in page units.
 *
 * A delta has no origin, so it only needs the scale — passing it through
 * `screenToPage` would wrongly subtract the page offset.
 */
export function screenDeltaToPage(delta: Point, scale: number): Point {
  return { x: delta.x / scale, y: delta.y / scale };
}

/** Rounds to whole page units. Sub-unit coordinates help nobody. */
export function roundPoint(point: Point): Point {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}
