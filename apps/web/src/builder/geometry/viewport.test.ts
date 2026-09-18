import { PAGE_HEIGHT, PAGE_WIDTH } from "@formcraft/schema";
import { describe, expect, it } from "vitest";

import {
  pageToScreen,
  roundPoint,
  screenDeltaToPage,
  screenToPage,
} from "./viewport";

const rect = { left: 120, top: 64 };

describe("screen ↔ page conversion", () => {
  it("round-trips at every zoom level", () => {
    // If this ever stops holding, dropping an element lands somewhere other
    // than the cursor, and every gesture in the builder is subtly wrong.
    for (const scale of [0.25, 0.5, 1, 1.5, 2]) {
      for (const point of [
        { x: 0, y: 0 },
        { x: 397, y: 561 },
        { x: PAGE_WIDTH, y: PAGE_HEIGHT },
      ]) {
        const screen = pageToScreen(point, rect, scale);
        const back = screenToPage(screen, rect, scale);

        expect(back.x, `x at ${scale}`).toBeCloseTo(point.x, 9);
        expect(back.y, `y at ${scale}`).toBeCloseTo(point.y, 9);
      }
    }
  });

  it("maps the page origin to the rect origin", () => {
    expect(pageToScreen({ x: 0, y: 0 }, rect, 1)).toEqual({ x: 120, y: 64 });
    expect(screenToPage({ x: 120, y: 64 }, rect, 1)).toEqual({ x: 0, y: 0 });
  });

  it("halves page coordinates at 0.5 scale", () => {
    expect(pageToScreen({ x: 100, y: 200 }, { left: 0, top: 0 }, 0.5)).toEqual({
      x: 50,
      y: 100,
    });
  });

  it("gives negative page coordinates above and left of the page", () => {
    // Not clamped: the pointer genuinely can be off-page, and pretending
    // otherwise would make a drag that leaves the page jump.
    const point = screenToPage({ x: 100, y: 50 }, rect, 1);

    expect(point.x).toBe(-20);
    expect(point.y).toBe(-14);
  });
});

describe("deltas", () => {
  it("ignore the page offset", () => {
    // A displacement has no origin. Subtracting the page position here would
    // send every drag flying by the page's distance from the viewport corner.
    expect(screenDeltaToPage({ x: 50, y: 20 }, 1)).toEqual({ x: 50, y: 20 });
  });

  it("scale inversely with zoom", () => {
    expect(screenDeltaToPage({ x: 50, y: 20 }, 0.5)).toEqual({ x: 100, y: 40 });
    expect(screenDeltaToPage({ x: 50, y: 20 }, 2)).toEqual({ x: 25, y: 10 });
  });
});

describe("rounding", () => {
  it("snaps to whole page units", () => {
    expect(roundPoint({ x: 10.4, y: -3.6 })).toEqual({ x: 10, y: -4 });
  });
});
