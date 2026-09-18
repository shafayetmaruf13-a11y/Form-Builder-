import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  type FormElement,
  type Geometry,
} from "@formcraft/schema";

import { HANDLES, type HandleName, MIN_SIZE, type Rect } from "./transform";

/**
 * Snapping and alignment guides.
 *
 * Two independent mechanisms, because they answer different questions. The
 * grid keeps things tidy in the absence of anything to line up with; guides
 * line things up with what is actually there, and are what make a canvas feel
 * like a design tool rather than a free-for-all.
 *
 * Candidate edges are collected once when a gesture starts, not recomputed per
 * frame — with a hundred elements that is the difference between a smooth drag
 * and a janky one.
 */

export const GRID_SIZE = 8;

/** How close, in on-screen pixels, before a guide takes hold. */
export const SNAP_THRESHOLD_PX = 6;

export function snapToGrid(value: number, grid: number = GRID_SIZE): number {
  return Math.round(value / grid) * grid;
}

/**
 * Grid-snaps a resize, moving only the edges the handle actually drags.
 *
 * Snapping all four sides would shift the anchored corner — drag the
 * south-east handle and the top edge would twitch onto the grid, which is not
 * what "resize from this corner" means. So the handle's own signs decide which
 * edges are eligible, and the opposite ones are left exactly where they are.
 *
 * A rotated element is returned untouched: the grid is axis-aligned and a
 * rotated box has no axis-aligned edges to put on it. Snapping its bounding box
 * instead would silently change the element's size.
 */
export function snapResizeToGrid(
  geometry: Geometry,
  handle: HandleName,
  grid: number = GRID_SIZE,
): Geometry {
  if (geometry.rotation !== 0) return geometry;

  const { sx, sy } = HANDLES[handle];
  let { x, y, w, h } = geometry;

  if (sx === 1) {
    w = Math.max(MIN_SIZE, snapToGrid(x + w, grid) - x);
  } else if (sx === -1) {
    const left = snapToGrid(x, grid);
    w = Math.max(MIN_SIZE, x + w - left);
    x = left;
  }

  if (sy === 1) {
    h = Math.max(MIN_SIZE, snapToGrid(y + h, grid) - y);
  } else if (sy === -1) {
    const top = snapToGrid(y, grid);
    h = Math.max(MIN_SIZE, y + h - top);
    y = top;
  }

  return { x, y, w, h, rotation: geometry.rotation };
}

/** Vertical and horizontal lines worth snapping to, in page units. */
export interface SnapCandidates {
  vertical: number[];
  horizontal: number[];
}

/**
 * Edges to align against: every other element's left/centre/right and
 * top/middle/bottom, plus the page's own edges and centrelines.
 *
 * Elements being dragged are excluded — an element cannot align to itself.
 */
export function collectSnapCandidates(
  elements: readonly FormElement[],
  excludeIds: readonly string[],
): SnapCandidates {
  const excluded = new Set(excludeIds);
  const vertical = new Set<number>([0, PAGE_WIDTH / 2, PAGE_WIDTH]);
  const horizontal = new Set<number>([0, PAGE_HEIGHT / 2, PAGE_HEIGHT]);

  for (const element of elements) {
    if (excluded.has(element.id)) continue;

    vertical.add(element.x);
    vertical.add(element.x + element.w / 2);
    vertical.add(element.x + element.w);

    horizontal.add(element.y);
    horizontal.add(element.y + element.h / 2);
    horizontal.add(element.y + element.h);
  }

  return { vertical: [...vertical], horizontal: [...horizontal] };
}

/** A line to draw while a gesture is snapped to it. */
export interface Guide {
  axis: "vertical" | "horizontal";
  /** Page-unit position of the line. */
  position: number;
}

export interface SnapResult {
  /** Correction to add to the moving bounds, in page units. */
  dx: number;
  dy: number;
  guides: Guide[];
}

const NO_SNAP: SnapResult = { dx: 0, dy: 0, guides: [] };

/**
 * Finds the nearest alignment for a box being moved.
 *
 * Each axis is considered independently, and each compares three points on the
 * box — leading edge, centre, trailing edge — against every candidate. The
 * closest match inside the threshold wins, and only that one produces a guide,
 * so the canvas shows the line the element actually snapped to rather than
 * every line it is vaguely near.
 */
export function resolveSnap(
  bounds: Rect,
  candidates: SnapCandidates,
  threshold: number,
): SnapResult {
  if (threshold <= 0) return NO_SNAP;

  const x = bestAxisSnap(
    [bounds.x, bounds.x + bounds.w / 2, bounds.x + bounds.w],
    candidates.vertical,
    threshold,
  );
  const y = bestAxisSnap(
    [bounds.y, bounds.y + bounds.h / 2, bounds.y + bounds.h],
    candidates.horizontal,
    threshold,
  );

  const guides: Guide[] = [];
  if (x) guides.push({ axis: "vertical", position: x.position });
  if (y) guides.push({ axis: "horizontal", position: y.position });

  return { dx: x?.delta ?? 0, dy: y?.delta ?? 0, guides };
}

function bestAxisSnap(
  points: readonly number[],
  candidates: readonly number[],
  threshold: number,
): { delta: number; position: number } | null {
  let best: { delta: number; position: number; distance: number } | null = null;

  for (const point of points) {
    for (const candidate of candidates) {
      const distance = Math.abs(candidate - point);
      if (distance > threshold) continue;
      if (best && distance >= best.distance) continue;

      best = { delta: candidate - point, position: candidate, distance };
    }
  }

  return best ? { delta: best.delta, position: best.position } : null;
}
