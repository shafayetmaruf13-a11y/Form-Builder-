import { PAGE_HEIGHT, PAGE_WIDTH, createElement } from "@formcraft/schema";
import { describe, expect, it } from "vitest";

import {
  GRID_SIZE,
  collectSnapCandidates,
  resolveSnap,
  snapResizeToGrid,
  snapToGrid,
} from "./snapping";

function element(id: string, x: number, y: number, w = 100, h = 50) {
  return { ...createElement("text", id, { x, y }), w, h };
}

describe("grid snapping", () => {
  it("rounds to the nearest grid line", () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(3)).toBe(0);
    expect(snapToGrid(5)).toBe(8);
    expect(snapToGrid(11)).toBe(8);
    // Exactly midway rounds up, following Math.round.
    expect(snapToGrid(12)).toBe(16);
    expect(snapToGrid(13)).toBe(16);
  });

  it("handles negatives", () => {
    expect(snapToGrid(-3)).toBe(-0);
    expect(snapToGrid(-13)).toBe(-16);
  });

  it("accepts a custom grid", () => {
    expect(snapToGrid(7, 10)).toBe(10);
    expect(GRID_SIZE).toBe(8);
  });
});

describe("grid-snapping a resize", () => {
  const start = { x: 40, y: 146, w: 350, h: 66, rotation: 0 };

  it("snaps the dragged edges and leaves the anchor alone", () => {
    // Dragging the south-east handle must not move the top-left corner. This
    // is the bug that snapping all four sides would introduce.
    const result = snapResizeToGrid(start, "se");

    expect(result.x).toBe(start.x);
    expect(result.y).toBe(start.y);
    expect(result.x + result.w).toBe(snapToGrid(start.x + start.w));
    expect(result.y + result.h).toBe(snapToGrid(start.y + start.h));
  });

  it("snaps the other pair of edges for the opposite handle", () => {
    const result = snapResizeToGrid(start, "nw");

    expect(result.x).toBe(snapToGrid(start.x));
    expect(result.y).toBe(snapToGrid(start.y));
    expect(result.x + result.w).toBe(start.x + start.w);
    expect(result.y + result.h).toBe(start.y + start.h);
  });

  it("leaves the untouched axis completely alone for an edge handle", () => {
    const result = snapResizeToGrid(start, "e");

    expect(result.y).toBe(start.y);
    expect(result.h).toBe(start.h);
    expect(result.x + result.w).toBe(snapToGrid(start.x + start.w));
  });

  it("does not touch a rotated element", () => {
    // The grid is axis-aligned; a rotated box has no axis-aligned edges to put
    // on it, and snapping its bounding box would change its actual size.
    const rotated = { ...start, rotation: 30 };

    expect(snapResizeToGrid(rotated, "se")).toBe(rotated);
  });

  it("never snaps below the minimum size", () => {
    const tiny = { x: 3, y: 3, w: 9, h: 9, rotation: 0 };
    const result = snapResizeToGrid(tiny, "nw");

    expect(result.w).toBeGreaterThanOrEqual(8);
    expect(result.h).toBeGreaterThanOrEqual(8);
  });
});

describe("collecting candidates", () => {
  it("includes the page edges and centrelines", () => {
    const { vertical, horizontal } = collectSnapCandidates([], []);

    expect(vertical).toContain(0);
    expect(vertical).toContain(PAGE_WIDTH / 2);
    expect(vertical).toContain(PAGE_WIDTH);
    expect(horizontal).toContain(PAGE_HEIGHT / 2);
  });

  it("includes each element's edges and centre", () => {
    const { vertical, horizontal } = collectSnapCandidates(
      [element("el_a", 100, 200, 60, 40)],
      [],
    );

    expect(vertical).toContain(100);
    expect(vertical).toContain(130);
    expect(vertical).toContain(160);
    expect(horizontal).toContain(200);
    expect(horizontal).toContain(220);
    expect(horizontal).toContain(240);
  });

  it("excludes the elements being dragged", () => {
    // An element cannot align to itself; without this every drag would stick
    // to its own starting position.
    const { vertical } = collectSnapCandidates(
      [element("el_a", 333, 0), element("el_b", 444, 0)],
      ["el_a"],
    );

    expect(vertical).not.toContain(333);
    expect(vertical).toContain(444);
  });

  it("deduplicates shared edges", () => {
    const { vertical } = collectSnapCandidates(
      [element("el_a", 100, 0), element("el_b", 100, 60)],
      [],
    );

    expect(vertical.filter((value) => value === 100)).toHaveLength(1);
  });
});

describe("resolving a snap", () => {
  const candidates = { vertical: [200], horizontal: [400] };

  it("pulls a near edge onto the line", () => {
    const result = resolveSnap({ x: 197, y: 0, w: 50, h: 50 }, candidates, 6);

    expect(result.dx).toBe(3);
    expect(result.guides).toContainEqual({ axis: "vertical", position: 200 });
  });

  it("ignores anything beyond the threshold", () => {
    // Every point of this box — left 150, centre 160, right 170 — is well
    // clear of the candidate at 200.
    const result = resolveSnap({ x: 150, y: 0, w: 20, h: 20 }, candidates, 6);

    expect(result).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("snaps on any of the three points, not just the leading edge", () => {
    // Left edge at 180 is 20 away, but the centre at 205 is only 5 away.
    const result = resolveSnap({ x: 180, y: 0, w: 50, h: 50 }, candidates, 6);

    expect(result.dx).toBe(-5);
  });

  it("snaps the trailing edge as readily as the leading one", () => {
    // Box right edge at 203 should pull left by 3 to meet the line at 200.
    const result = resolveSnap({ x: 153, y: 0, w: 50, h: 50 }, candidates, 6);

    expect(result.dx).toBe(-3);
  });

  it("snaps on the centre too", () => {
    const result = resolveSnap({ x: 174, y: 0, w: 50, h: 50 }, candidates, 6);

    expect(result.dx).toBe(1);
  });

  it("prefers the closest match when several are in range", () => {
    const result = resolveSnap(
      { x: 199, y: 0, w: 50, h: 50 },
      { vertical: [196, 200], horizontal: [] },
      6,
    );

    expect(result.dx).toBe(1);
    expect(result.guides).toEqual([{ axis: "vertical", position: 200 }]);
  });

  it("produces at most one guide per axis", () => {
    const result = resolveSnap(
      { x: 198, y: 398, w: 50, h: 50 },
      { vertical: [200, 201], horizontal: [400, 402] },
      6,
    );

    expect(result.guides.filter((g) => g.axis === "vertical")).toHaveLength(1);
    expect(result.guides.filter((g) => g.axis === "horizontal")).toHaveLength(
      1,
    );
  });

  it("treats the axes independently", () => {
    const result = resolveSnap(
      { x: 197, y: 0, w: 50, h: 50 },
      { vertical: [200], horizontal: [] },
      6,
    );

    expect(result.dx).toBe(3);
    expect(result.dy).toBe(0);
  });

  it("does nothing when snapping is off", () => {
    expect(
      resolveSnap({ x: 199, y: 399, w: 50, h: 50 }, candidates, 0),
    ).toEqual({ dx: 0, dy: 0, guides: [] });
  });
});
