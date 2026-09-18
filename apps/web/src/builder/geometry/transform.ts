import type { Geometry } from "@formcraft/schema";

import type { Point } from "./viewport";

/**
 * Resize and rotation maths, in page units.
 *
 * Pure functions with no DOM and no React, because this is the part of the
 * builder most likely to be subtly wrong and least likely to be caught by
 * looking at it.
 */

/** An axis-aligned box in page units. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Nothing may be resized smaller than this; a zero-area element is a trap. */
export const MIN_SIZE = 8;

/**
 * The eight resize handles, named by compass point.
 *
 * `sx`/`sy` say which way each handle pushes: +1 grows the right/bottom edge,
 * -1 grows the left/top edge, 0 leaves that axis alone. The opposite corner —
 * the anchor that stays put — falls straight out of these signs.
 */
export const HANDLES = {
  nw: { sx: -1, sy: -1 },
  n: { sx: 0, sy: -1 },
  ne: { sx: 1, sy: -1 },
  e: { sx: 1, sy: 0 },
  se: { sx: 1, sy: 1 },
  s: { sx: 0, sy: 1 },
  sw: { sx: -1, sy: 1 },
  w: { sx: -1, sy: 0 },
} as const;

export type HandleName = keyof typeof HANDLES;

export const HANDLE_NAMES = Object.keys(HANDLES) as HandleName[];

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Rotates a vector about the origin. */
export function rotateVector(point: Point, degrees: number): Point {
  if (degrees === 0) return point;
  const radians = toRadians(degrees);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

export function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * Resizes by dragging a handle.
 *
 * The subtlety is rotation. An element rotates about its own centre, so
 * changing its width moves that centre — and with it, every corner, including
 * the one the user is holding still. Doing this naively makes a rotated
 * element crawl away as you resize it.
 *
 * So the anchor (the corner opposite the handle) is pinned in *page* space:
 *
 *   1. the pointer delta is rotated into the element's own frame, where the
 *      handle signs apply straightforwardly to width and height;
 *   2. the anchor's page position is computed from the original geometry;
 *   3. the new centre is whatever puts the anchor back exactly where it was.
 *
 * For an unrotated element this reduces to the obvious "move one edge".
 */
export function resizeRect(
  start: Geometry,
  handle: HandleName,
  pointerDelta: Point,
  options: { preserveAspect?: boolean } = {},
): Geometry {
  const { sx, sy } = HANDLES[handle];

  // 1. The drag, expressed in the element's own (unrotated) frame.
  const local = rotateVector(pointerDelta, -start.rotation);

  let w = Math.max(MIN_SIZE, start.w + sx * local.x);
  let h = Math.max(MIN_SIZE, start.h + sy * local.y);

  if (options.preserveAspect && sx !== 0 && sy !== 0) {
    // Corner drags with shift keep the original proportions; the larger of the
    // two relative changes wins so the element follows the pointer.
    const ratio = start.w / start.h;
    if (Math.abs(w / start.w - 1) > Math.abs(h / start.h - 1)) {
      h = Math.max(MIN_SIZE, w / ratio);
    } else {
      w = Math.max(MIN_SIZE, h * ratio);
    }
  }

  // 2. Where the anchor is now, in page space.
  const center = centerOf(start);
  const anchorLocal = { x: (-sx * start.w) / 2, y: (-sy * start.h) / 2 };
  const anchorRotated = rotateVector(anchorLocal, start.rotation);
  const anchor = {
    x: center.x + anchorRotated.x,
    y: center.y + anchorRotated.y,
  };

  // 3. The centre that puts the anchor back where it was.
  const nextAnchorLocal = { x: (-sx * w) / 2, y: (-sy * h) / 2 };
  const nextAnchorRotated = rotateVector(nextAnchorLocal, start.rotation);
  const nextCenter = {
    x: anchor.x - nextAnchorRotated.x,
    y: anchor.y - nextAnchorRotated.y,
  };

  return {
    x: nextCenter.x - w / 2,
    y: nextCenter.y - h / 2,
    w,
    h,
    rotation: start.rotation,
  };
}

/** Degrees, normalised to [0, 360). */
export function normalizeRotation(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * The rotation implied by dragging the rotate handle to a point.
 *
 * Measured as the change in angle from where the gesture began, so grabbing
 * the handle never makes the element jump.
 */
export function rotationFromPointer(
  center: Point,
  pointer: Point,
  startPointer: Point,
  startRotation: number,
  options: { snapDegrees?: number } = {},
): number {
  const angle = (p: Point) =>
    (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI;

  const raw = startRotation + (angle(pointer) - angle(startPointer));
  const snap = options.snapDegrees;

  return normalizeRotation(
    snap ? Math.round(raw / snap) * snap : Math.round(raw * 10) / 10,
  );
}

/**
 * The axis-aligned box enclosing several rects.
 *
 * Rotation is deliberately ignored: this drives selection outlines and marquee
 * hit-testing, where a rotated element's *unrotated* box is the honest thing
 * to compare against what the user drew.
 */
export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.w);
    maxY = Math.max(maxY, rect.y + rect.h);
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** True when two boxes overlap at all. Touching edges do not count. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

/** A rect from two corners, in any order. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/** Rounds geometry to whole page units. */
export function roundGeometry(geometry: Geometry): Geometry {
  return {
    x: Math.round(geometry.x),
    y: Math.round(geometry.y),
    w: Math.max(MIN_SIZE, Math.round(geometry.w)),
    h: Math.max(MIN_SIZE, Math.round(geometry.h)),
    rotation: geometry.rotation,
  };
}
