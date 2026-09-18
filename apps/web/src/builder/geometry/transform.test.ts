import type { Geometry } from "@formcraft/schema";
import { describe, expect, it } from "vitest";

import {
  HANDLE_NAMES,
  type HandleName,
  MIN_SIZE,
  boundsOf,
  centerOf,
  normalizeRotation,
  rectFromPoints,
  rectsIntersect,
  resizeRect,
  rotateVector,
  rotationFromPointer,
} from "./transform";

const base: Geometry = { x: 100, y: 100, w: 200, h: 100, rotation: 0 };

/** The four corners of a geometry, in page space, rotation included. */
function corners(geometry: Geometry) {
  const center = centerOf(geometry);
  const half = { x: geometry.w / 2, y: geometry.h / 2 };

  return {
    nw: corner(-1, -1),
    ne: corner(1, -1),
    se: corner(1, 1),
    sw: corner(-1, 1),
  };

  function corner(sx: number, sy: number) {
    const rotated = rotateVector(
      { x: sx * half.x, y: sy * half.y },
      geometry.rotation,
    );
    return { x: center.x + rotated.x, y: center.y + rotated.y };
  }
}

describe("rotateVector", () => {
  it("leaves a vector alone at 0 degrees", () => {
    expect(rotateVector({ x: 3, y: 4 }, 0)).toEqual({ x: 3, y: 4 });
  });

  it("turns +x into +y at 90 degrees", () => {
    const result = rotateVector({ x: 10, y: 0 }, 90);

    expect(result.x).toBeCloseTo(0, 9);
    expect(result.y).toBeCloseTo(10, 9);
  });

  it("round-trips through the inverse rotation", () => {
    for (const degrees of [17, 45, -33, 180, 359]) {
      const there = rotateVector({ x: 12, y: -5 }, degrees);
      const back = rotateVector(there, -degrees);

      expect(back.x).toBeCloseTo(12, 9);
      expect(back.y).toBeCloseTo(-5, 9);
    }
  });
});

describe("resizeRect, unrotated", () => {
  it("drags the south-east corner and leaves the north-west alone", () => {
    const result = resizeRect(base, "se", { x: 40, y: 20 });

    expect(result).toEqual({ x: 100, y: 100, w: 240, h: 120, rotation: 0 });
  });

  it("drags the north-west corner and leaves the south-east alone", () => {
    const result = resizeRect(base, "nw", { x: 40, y: 20 });

    expect(result).toEqual({ x: 140, y: 120, w: 160, h: 80, rotation: 0 });
    expect(result.x + result.w).toBe(base.x + base.w);
    expect(result.y + result.h).toBe(base.y + base.h);
  });

  it("moves only one axis for an edge handle", () => {
    expect(resizeRect(base, "e", { x: 30, y: 999 })).toEqual({
      x: 100,
      y: 100,
      w: 230,
      h: 100,
      rotation: 0,
    });

    expect(resizeRect(base, "n", { x: 999, y: 25 })).toEqual({
      x: 100,
      y: 125,
      w: 200,
      h: 75,
      rotation: 0,
    });
  });

  it("clamps to a minimum size rather than inverting", () => {
    const result = resizeRect(base, "se", { x: -9999, y: -9999 });

    expect(result.w).toBe(MIN_SIZE);
    expect(result.h).toBe(MIN_SIZE);
  });

  it("keeps proportions when asked", () => {
    const result = resizeRect(
      base,
      "se",
      { x: 100, y: 0 },
      { preserveAspect: true },
    );

    expect(result.w / result.h).toBeCloseTo(base.w / base.h, 9);
  });
});

describe("resizeRect, rotated", () => {
  // The property that matters: whatever the rotation, the corner opposite the
  // handle must not move. Without this a rotated element crawls away as you
  // resize it, which is the classic bug in canvas editors.

  it("pins the opposite corner at every rotation, for every handle", () => {
    const opposite: Record<HandleName, "nw" | "ne" | "se" | "sw" | null> = {
      se: "nw",
      nw: "se",
      ne: "sw",
      sw: "ne",
      n: null,
      s: null,
      e: null,
      w: null,
    };

    for (const rotation of [0, 15, 37, 90, 143, 270, -22]) {
      const start: Geometry = { ...base, rotation };
      const before = corners(start);

      for (const handle of HANDLE_NAMES) {
        const anchor = opposite[handle];
        if (!anchor) continue;

        const result = resizeRect(start, handle, { x: 35, y: -18 });
        const after = corners(result);

        expect(after[anchor].x, `${handle} at ${rotation}°`).toBeCloseTo(
          before[anchor].x,
          6,
        );
        expect(after[anchor].y, `${handle} at ${rotation}°`).toBeCloseTo(
          before[anchor].y,
          6,
        );
      }
    }
  });

  it("grows along the element's own axes, not the screen's", () => {
    // At 90°, dragging the east handle by a screen-space +y vector should
    // lengthen the element's width, because its local +x now points down.
    const start: Geometry = { ...base, rotation: 90 };
    const result = resizeRect(start, "e", { x: 0, y: 50 });

    expect(result.w).toBeCloseTo(base.w + 50, 6);
    expect(result.h).toBeCloseTo(base.h, 6);
  });

  it("preserves the rotation it was given", () => {
    expect(
      resizeRect({ ...base, rotation: 42 }, "se", { x: 10, y: 10 }).rotation,
    ).toBe(42);
  });

  it("does nothing for a zero delta", () => {
    for (const rotation of [0, 33, 180]) {
      const start: Geometry = { ...base, rotation };
      const result = resizeRect(start, "se", { x: 0, y: 0 });

      expect(result.x).toBeCloseTo(start.x, 9);
      expect(result.y).toBeCloseTo(start.y, 9);
      expect(result.w).toBeCloseTo(start.w, 9);
      expect(result.h).toBeCloseTo(start.h, 9);
    }
  });
});

describe("rotationFromPointer", () => {
  const center = { x: 100, y: 100 };

  it("does not jump when the handle is first grabbed", () => {
    const start = { x: 100, y: 40 };

    expect(rotationFromPointer(center, start, start, 30)).toBe(30);
  });

  it("follows the pointer around the centre", () => {
    // Start directly above, drag to directly right: a quarter turn clockwise.
    const result = rotationFromPointer(
      center,
      { x: 160, y: 100 },
      { x: 100, y: 40 },
      0,
    );

    expect(result).toBeCloseTo(90, 6);
  });

  it("snaps to the given increment", () => {
    const result = rotationFromPointer(
      center,
      { x: 160, y: 108 },
      { x: 100, y: 40 },
      0,
      { snapDegrees: 15 },
    );

    expect(result % 15).toBe(0);
  });

  it("normalises into [0, 360)", () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(360)).toBe(0);
  });
});

describe("bounds and hit testing", () => {
  it("encloses several rects", () => {
    expect(
      boundsOf([
        { x: 10, y: 20, w: 30, h: 40 },
        { x: 100, y: 5, w: 10, h: 10 },
      ]),
    ).toEqual({ x: 10, y: 5, w: 100, h: 55 });
  });

  it("returns null for nothing", () => {
    expect(boundsOf([])).toBeNull();
  });

  it("detects overlap but not mere touching", () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };

    expect(rectsIntersect(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsIntersect(a, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
    expect(rectsIntersect(a, { x: 20, y: 20, w: 1, h: 1 })).toBe(false);
  });

  it("builds a rect from corners dragged in any direction", () => {
    const expected = { x: 10, y: 20, w: 30, h: 40 };

    expect(rectFromPoints({ x: 10, y: 20 }, { x: 40, y: 60 })).toEqual(
      expected,
    );
    expect(rectFromPoints({ x: 40, y: 60 }, { x: 10, y: 20 })).toEqual(
      expected,
    );
  });
});
