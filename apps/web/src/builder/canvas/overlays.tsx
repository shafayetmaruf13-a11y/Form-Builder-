"use client";

import { PAGE_HEIGHT, PAGE_WIDTH } from "@formcraft/schema";

import type { Rect } from "../geometry/transform";
import { useGuides, useMarquee, useScale } from "../store/use-builder";

/**
 * The lines that appear when a gesture snaps to something.
 *
 * Drawn the full length of the page, as design tools do, so it is obvious what
 * the element lined up with rather than merely that it stopped moving.
 */
export function AlignmentGuides() {
  const guides = useGuides();
  const scale = useScale();

  if (guides.length === 0) return null;

  return (
    <>
      {guides.map((guide) => (
        <div
          key={`${guide.axis}-${guide.position}`}
          style={{
            position: "absolute",
            backgroundColor: "#ec4899",
            pointerEvents: "none",
            ...(guide.axis === "vertical"
              ? {
                  left: guide.position,
                  top: 0,
                  width: 1 / scale,
                  height: PAGE_HEIGHT,
                }
              : {
                  left: 0,
                  top: guide.position,
                  width: PAGE_WIDTH,
                  height: 1 / scale,
                }),
          }}
        />
      ))}
    </>
  );
}

/** The rubber-band rectangle drawn while dragging on empty canvas. */
export function MarqueeBox() {
  const rect = useMarquee();
  const scale = useScale();

  if (!rect) return null;

  return <RectOutline rect={rect} scale={scale} />;
}

function RectOutline({ rect, scale }: { rect: Rect; scale: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        border: `${1 / scale}px solid #2563eb`,
        backgroundColor: "rgba(37, 99, 235, 0.08)",
        pointerEvents: "none",
      }}
    />
  );
}

/**
 * The outline around a multiple selection.
 *
 * No handles: resizing several elements at once means deciding how each one
 * scales within the group, which is its own piece of work. Multiple selections
 * can be moved, nudged, restacked, copied and deleted.
 */
export function MultiSelectionOutline({
  rect,
  offset,
}: {
  rect: Rect;
  /** Live move displacement, so the outline travels with what it encloses. */
  offset?: { dx: number; dy: number } | null;
}) {
  const scale = useScale();

  return (
    <div
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        transform: offset
          ? `translate(${offset.dx}px, ${offset.dy}px)`
          : undefined,
        border: `${1 / scale}px dashed #2563eb`,
        pointerEvents: "none",
      }}
    />
  );
}
