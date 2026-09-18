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
}: {
  element: FormElement;
  children: ReactNode;
}) {
  const { x, y, w, h, rotation, z, style } = element;

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
        // Rotation is about the centre, matching how the builder's rotate
        // handle will behave and how the PDF must reproduce it.
        transform: rotation === 0 ? undefined : `rotate(${rotation}deg)`,
        transformOrigin: "center center",
        opacity: style.opacity,
        zIndex: z,
      }}
    >
      {children}
    </div>
  );
}
