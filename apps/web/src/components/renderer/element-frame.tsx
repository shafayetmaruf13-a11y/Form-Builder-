import type { FormElement } from "@formcraft/schema";
import type { ReactNode } from "react";

/**
 * Positions one element on the page.
 *
 * This is the only place in the app that turns document coordinates into CSS.
 * Note what it does *not* do: it never sees the page's scale. The surface
 * scales the whole page once, so every element is laid out at its raw document
 * coordinates and cannot drift from them (architecture rule 2).
 */
export function ElementFrame({
  element,
  children,
  offset,
}: {
  element: FormElement;
  children: ReactNode;
  /**
   * A live, uncommitted displacement in page units.
   *
   * The builder sets this while an element is being dragged, so the element
   * itself moves at pointer speed without the document being written to sixty
   * times a second. It is always null outside a gesture, which is why the PDF
   * and fill-page renderers never pass it.
   */
  offset?: { dx: number; dy: number } | null;
}) {
  const { x, y, w, h, rotation, z, style } = element;

  // Translate before rotate: the element rotates about its own centre, and the
  // drag then moves that whole rotated box.
  const transform = [
    offset ? `translate(${offset.dx}px, ${offset.dy}px)` : "",
    rotation === 0 ? "" : `rotate(${rotation}deg)`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      data-element-id={element.id}
      data-element-type={element.type}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        transform: transform === "" ? undefined : transform,
        transformOrigin: "center center",
        // Hints the compositor during a drag; harmless when idle.
        willChange: offset ? "transform" : undefined,
        opacity: style.opacity,
        zIndex: z,
      }}
    >
      {children}
    </div>
  );
}
