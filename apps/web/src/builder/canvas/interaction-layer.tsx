"use client";

import { PAGE_HEIGHT, PAGE_WIDTH, type Page } from "@formcraft/schema";
import { useDraggable } from "@dnd-kit/core";
import { type RefObject, useRef } from "react";

import {
  type Rect,
  boundsOf,
  rectFromPoints,
  rectsIntersect,
} from "../geometry/transform";
import { screenToPage } from "../geometry/viewport";
import {
  useBuilderStore,
  useDragOffset,
  useElement,
  useIsSelected,
  useScale,
  useSelection,
} from "../store/use-builder";
import { AlignmentGuides, MarqueeBox, MultiSelectionOutline } from "./overlays";
import { SelectionBox } from "./selection-box";

/**
 * The interactive overlay.
 *
 * Elements are drawn by the read-only renderer underneath and take no pointer
 * events. Everything clickable lives here, sharing the page's coordinate
 * system and its single scale transform — which is what lets the builder reuse
 * the PDF's renderer verbatim instead of growing an interactive copy that
 * would drift from it.
 */
export function InteractionLayer({
  page,
  pageRef,
}: {
  page: Page;
  pageRef: RefObject<HTMLDivElement | null>;
}) {
  const store = useBuilderStore();
  const scale = useScale();
  const selection = useSelection();

  // Marquee origin, in page units. A ref rather than state: it changes on every
  // frame and nothing renders from it directly.
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);
  const marqueeAdditive = useRef(false);

  function pointerToPage(event: React.PointerEvent) {
    const rect = pageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return screenToPage({ x: event.clientX, y: event.clientY }, rect, scale);
  }

  function onBackgroundPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const origin = pointerToPage(event);
    if (!origin) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    marqueeStart.current = origin;
    // Shift keeps the existing selection and adds whatever the band catches.
    marqueeAdditive.current = event.shiftKey;

    if (!event.shiftKey) store.clearSelection();
  }

  function onBackgroundPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const origin = marqueeStart.current;
    if (!origin) return;

    const current = pointerToPage(event);
    if (!current) return;

    store.setMarquee(rectFromPoints(origin, current));
  }

  function onBackgroundPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const origin = marqueeStart.current;
    marqueeStart.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);

    const gesture = store.getState().gesture;
    store.setMarquee(null);

    if (!origin || gesture?.kind !== "marquee") return;

    const caught = page.elements
      .filter((element) => rectsIntersect(gesture.rect, element))
      .map((element) => element.id);

    store.select(
      marqueeAdditive.current
        ? [...new Set([...store.getState().selection, ...caught])]
        : caught,
    );
  }

  const selectedRects = page.elements.filter((element) =>
    selection.includes(element.id),
  );
  const multiBounds = selectedRects.length > 1 ? boundsOf(selectedRects) : null;

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onBackgroundPointerMove}
      onPointerUp={onBackgroundPointerUp}
      onPointerCancel={onBackgroundPointerUp}
      style={{ touchAction: "none" }}
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
          <ElementHitBox key={element.id} id={element.id} />
        ))}

        {selection.length === 1 && (
          <SelectionBox id={selection[0]!} pageRef={pageRef} />
        )}
        {multiBounds && selection[0] && (
          <MultiSelectionOutlineForSelection
            rect={multiBounds}
            anyId={selection[0]}
          />
        )}

        <AlignmentGuides />
        <MarqueeBox />
      </div>
    </div>
  );
}

/**
 * Everything in a selection moves by the same offset, so watching any one
 * member is enough to know where the group outline should be.
 */
function MultiSelectionOutlineForSelection({
  rect,
  anyId,
}: {
  rect: Rect;
  anyId: string;
}) {
  const offset = useDragOffset(anyId);

  return <MultiSelectionOutline rect={rect} offset={offset} />;
}

/**
 * The clickable, draggable stand-in for one element.
 *
 * It mirrors the element's geometry exactly, rotation included, so the thing
 * you grab is the thing you see.
 */
function ElementHitBox({ id }: { id: string }) {
  const store = useBuilderStore();
  const element = useElement(id);
  const isSelected = useIsSelected(id);
  const offset = useDragOffset(id);
  const scale = useScale();

  const { attributes, listeners, setNodeRef } = useDraggable({
    id,
    data: { kind: "element", id },
  });

  if (!element) return null;

  const transform = [
    offset ? `translate(${offset.dx}px, ${offset.dy}px)` : "",
    element.rotation === 0 ? "" : `rotate(${element.rotation}deg)`,
  ]
    .filter(Boolean)
    .join(" ");

  /**
   * Selects, then hands the event on to dnd-kit.
   *
   * Both must happen: overriding dnd-kit's own handler rather than chaining to
   * it would leave the element selectable but immovable. The sensor's small
   * activation distance keeps a plain click from counting as a drag.
   */
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();

    if (event.shiftKey) {
      store.toggleSelection(id);
    } else if (!store.getState().selection.includes(id)) {
      // Clicking inside an existing multiple selection keeps it, so the whole
      // group can be dragged from any of its members.
      store.select([id]);
    }

    listeners?.onPointerDown?.(event);
  };

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
        // Chrome only — drawn at constant on-screen thickness so selection
        // stays legible when zoomed out. Never reaches the document or the PDF.
        outline:
          isSelected && !offset ? `${1 / scale}px solid #93c5fd` : undefined,
        backgroundColor: isSelected ? "rgba(37, 99, 235, 0.06)" : "transparent",
        touchAction: "none",
        willChange: offset ? "transform" : undefined,
      }}
    />
  );
}
