"use client";

import { PAGE_HEIGHT, PAGE_WIDTH, type Page } from "@formcraft/schema";
import { useDraggable } from "@dnd-kit/core";

import {
  useBuilderStore,
  useDragOffset,
  useElement,
  useIsSelected,
} from "../store/use-builder";

/**
 * The interactive overlay.
 *
 * Elements themselves are drawn by the read-only renderer underneath and take
 * no pointer events. Everything clickable lives here, in a layer that shares
 * the page's coordinate system and its single scale transform. Keeping the two
 * apart is what lets the builder reuse the PDF's renderer verbatim instead of
 * growing an interactive copy of it that would drift.
 */
export function InteractionLayer({
  page,
  scale,
  onBackgroundPointerDown,
}: {
  page: Page;
  scale: number;
  onBackgroundPointerDown: () => void;
}) {
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      onPointerDown={onBackgroundPointerDown}
    >
      <div
        style={{
          position: "relative",
          width: PAGE_WIDTH,
          height: PAGE_HEIGHT,
          transform: scale === 1 ? undefined : `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {page.elements.map((element) => (
          <ElementHitBox key={element.id} id={element.id} scale={scale} />
        ))}
      </div>
    </div>
  );
}

/**
 * The clickable, draggable stand-in for one element.
 *
 * It mirrors the element's geometry exactly, rotation included, so the thing
 * you grab is the thing you see.
 */
function ElementHitBox({ id, scale }: { id: string; scale: number }) {
  const store = useBuilderStore();
  const element = useElement(id);
  const isSelected = useIsSelected(id);
  const offset = useDragOffset(id);

  const { attributes, listeners, setNodeRef } = useDraggable({
    id,
    data: { kind: "element", id },
  });

  if (!element) return null;

  /**
   * Selects, then hands the event on to dnd-kit.
   *
   * Both must happen: overriding dnd-kit's own `onPointerDown` instead of
   * chaining to it would leave the element selectable but immovable. The
   * sensor's small activation distance is what keeps a plain click from
   * counting as a drag.
   */
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    store.select([id]);
    listeners?.onPointerDown?.(event);
  };

  const transform = [
    offset ? `translate(${offset.dx}px, ${offset.dy}px)` : "",
    element.rotation === 0 ? "" : `rotate(${element.rotation}deg)`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-hitbox-for={id}
      onPointerDown={handlePointerDown}
      style={{
        position: "absolute",
        left: element.x,
        top: element.y,
        width: element.w,
        height: element.h,
        transform: transform === "" ? undefined : transform,
        transformOrigin: "center center",
        cursor: "move",
        // Outlines are drawn at constant on-screen thickness, so selection
        // stays legible when zoomed out. This is chrome, not content — it
        // never reaches the document or the PDF.
        outline: isSelected
          ? `${2 / scale}px solid #2563eb`
          : `${1 / scale}px dashed transparent`,
        outlineOffset: 0,
        backgroundColor: isSelected ? "rgba(37, 99, 235, 0.06)" : "transparent",
        touchAction: "none",
        willChange: offset ? "transform" : undefined,
      }}
    />
  );
}
