"use client";

import type { Geometry } from "@formcraft/schema";
import { type RefObject, useRef } from "react";

import { snapResizeToGrid } from "../geometry/snapping";
import {
  HANDLE_NAMES,
  type HandleName,
  centerOf,
  resizeRect,
  roundGeometry,
  rotationFromPointer,
} from "../geometry/transform";
import { screenDeltaToPage, screenToPage } from "../geometry/viewport";
import { setGeometryCommand } from "../store/commands";
import {
  useBuilderStore,
  useDragOffset,
  useElement,
  useScale,
  useSnapEnabled,
  useTransformGeometry,
} from "../store/use-builder";

/** Handle size in screen pixels; divided by scale to stay constant on screen. */
const HANDLE_PX = 8;
const ROTATE_OFFSET_PX = 22;

const HANDLE_POSITION: Record<HandleName, { left: string; top: string }> = {
  nw: { left: "0%", top: "0%" },
  n: { left: "50%", top: "0%" },
  ne: { left: "100%", top: "0%" },
  e: { left: "100%", top: "50%" },
  se: { left: "100%", top: "100%" },
  s: { left: "50%", top: "100%" },
  sw: { left: "0%", top: "100%" },
  w: { left: "0%", top: "50%" },
};

const HANDLE_CURSOR: Record<HandleName, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  e: "ew-resize",
  se: "nwse-resize",
  s: "ns-resize",
  sw: "nesw-resize",
  w: "ew-resize",
};

/**
 * Resize and rotate handles for a single selected element.
 *
 * These use raw pointer capture rather than dnd-kit. dnd-kit is built around
 * dragging a thing from one place to another; a resize handle is a constraint
 * solver on the element's own geometry, and routing it through a drag
 * abstraction would cost clarity and frames for nothing.
 *
 * Pointer capture matters: once a handle is grabbed, every subsequent move
 * belongs to it even if the pointer leaves the element or the window.
 */
export function SelectionBox({
  id,
  pageRef,
}: {
  id: string;
  pageRef: RefObject<HTMLDivElement | null>;
}) {
  const store = useBuilderStore();
  const element = useElement(id);
  const live = useTransformGeometry(id);
  // The box has to travel with the element during a move, or the handles sit
  // behind while the element slides away from them.
  const offset = useDragOffset(id);
  const scale = useScale();
  const snapEnabled = useSnapEnabled();

  // The geometry the gesture started from, captured on pointer-down so every
  // frame is computed from the original rather than from the previous frame.
  const start = useRef<{
    geometry: Geometry;
    pointer: { x: number; y: number };
  } | null>(null);

  if (!element) return null;

  const geometry: Geometry = live ?? {
    x: element.x,
    y: element.y,
    w: element.w,
    h: element.h,
    rotation: element.rotation,
  };

  function beginGesture(event: React.PointerEvent<HTMLElement>) {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    start.current = {
      geometry: {
        x: element!.x,
        y: element!.y,
        w: element!.w,
        h: element!.h,
        rotation: element!.rotation,
      },
      pointer: { x: event.clientX, y: event.clientY },
    };
  }

  function endGesture(event: React.PointerEvent<HTMLElement>) {
    const started = start.current;
    start.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);

    const current = store.getState().gesture;
    store.setGesture(null);

    if (!started || current?.kind !== "transform") return;

    const after = roundGeometry(current.geometry);
    const before = started.geometry;
    if (
      after.x === before.x &&
      after.y === before.y &&
      after.w === before.w &&
      after.h === before.h &&
      after.rotation === before.rotation
    ) {
      return;
    }

    store.dispatch(
      setGeometryCommand(
        id,
        before,
        after,
        before.rotation === after.rotation ? "Resize" : "Rotate",
      ),
    );
  }

  function onResizeMove(
    event: React.PointerEvent<HTMLElement>,
    handle: HandleName,
  ) {
    const started = start.current;
    if (!started) return;

    const delta = screenDeltaToPage(
      {
        x: event.clientX - started.pointer.x,
        y: event.clientY - started.pointer.y,
      },
      scale,
    );

    let next = resizeRect(started.geometry, handle, delta, {
      preserveAspect: event.shiftKey,
    });

    if (snapEnabled) {
      // Only the dragged edges are snapped, so the anchored corner stays put.
      // Alignment guides are deliberately move-only for now — snapping a
      // dragged edge to a *neighbour's* edge is a different computation.
      next = snapResizeToGrid(next, handle);
    }

    store.setTransform(id, next);
  }

  function onRotateMove(event: React.PointerEvent<HTMLElement>) {
    const started = start.current;
    const rect = pageRef.current?.getBoundingClientRect();
    if (!started || !rect) return;

    const center = centerOf(started.geometry);
    const rotation = rotationFromPointer(
      center,
      screenToPage({ x: event.clientX, y: event.clientY }, rect, scale),
      screenToPage(started.pointer, rect, scale),
      started.geometry.rotation,
      // Shift snaps to 15°, as in most design tools.
      { snapDegrees: event.shiftKey ? 15 : undefined },
    );

    store.setTransform(id, { ...started.geometry, rotation });
  }

  const handleSize = HANDLE_PX / scale;

  return (
    <div
      style={{
        position: "absolute",
        left: geometry.x,
        top: geometry.y,
        width: geometry.w,
        height: geometry.h,
        transform:
          [
            offset ? `translate(${offset.dx}px, ${offset.dy}px)` : "",
            geometry.rotation === 0 ? "" : `rotate(${geometry.rotation}deg)`,
          ]
            .filter(Boolean)
            .join(" ") || undefined,
        transformOrigin: "center center",
        outline: `${2 / scale}px solid #2563eb`,
        pointerEvents: "none",
      }}
    >
      <div
        role="button"
        tabIndex={-1}
        aria-label="Rotate"
        onPointerDown={beginGesture}
        onPointerMove={onRotateMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        style={{
          position: "absolute",
          left: "50%",
          top: -ROTATE_OFFSET_PX / scale,
          width: handleSize * 1.25,
          height: handleSize * 1.25,
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
          background: "#ffffff",
          border: `${1.5 / scale}px solid #2563eb`,
          cursor: "grab",
          pointerEvents: "auto",
          touchAction: "none",
        }}
      />

      {HANDLE_NAMES.map((handle) => (
        <div
          key={handle}
          role="button"
          tabIndex={-1}
          aria-label={`Resize ${handle}`}
          data-handle={handle}
          onPointerDown={beginGesture}
          onPointerMove={(event) => {
            onResizeMove(event, handle);
          }}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          style={{
            position: "absolute",
            left: HANDLE_POSITION[handle].left,
            top: HANDLE_POSITION[handle].top,
            width: handleSize,
            height: handleSize,
            transform: "translate(-50%, -50%)",
            background: "#ffffff",
            border: `${1.5 / scale}px solid #2563eb`,
            borderRadius: 1 / scale,
            cursor: HANDLE_CURSOR[handle],
            pointerEvents: "auto",
            touchAction: "none",
          }}
        />
      ))}
    </div>
  );
}
