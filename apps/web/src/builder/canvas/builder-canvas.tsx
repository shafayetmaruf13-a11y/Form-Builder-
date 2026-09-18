"use client";

import { PAGE_HEIGHT, PAGE_WIDTH, type Page } from "@formcraft/schema";
import { useDroppable } from "@dnd-kit/core";
import type { RefObject } from "react";

import { PageSurface } from "@/components/renderer/page-surface";

import { useBuilderStore } from "../store/use-builder";
import { BuilderElement } from "./builder-element";
import { InteractionLayer } from "./interaction-layer";

export const CANVAS_DROPPABLE_ID = "builder-canvas";

/**
 * The page, plus everything you can do to it.
 *
 * Two stacked layers over one coordinate system: the read-only renderer from
 * Slice 1 underneath, and the interaction overlay on top. The renderer is
 * `pointer-events: none`, so every gesture is handled by the overlay and the
 * drawing code stays entirely unaware that a builder exists.
 */
export function BuilderCanvas({
  page,
  scale,
  pageRef,
}: {
  page: Page;
  scale: number;
  /** Measured at drop time to convert a pointer position into page units. */
  pageRef: RefObject<HTMLDivElement | null>;
}) {
  const store = useBuilderStore();
  const { setNodeRef } = useDroppable({ id: CANVAS_DROPPABLE_ID });

  return (
    <div
      ref={setNodeRef}
      className="flex min-h-full items-start justify-center bg-neutral-200 p-10 dark:bg-neutral-800"
    >
      <div
        ref={pageRef}
        className="relative shadow-lg"
        style={{ width: PAGE_WIDTH * scale, height: PAGE_HEIGHT * scale }}
      >
        <div className="pointer-events-none">
          <PageSurface
            page={page}
            scale={scale}
            renderElement={(element) => (
              <BuilderElement key={element.id} id={element.id} />
            )}
          />
        </div>

        <InteractionLayer
          page={page}
          scale={scale}
          onBackgroundPointerDown={() => {
            store.clearSelection();
          }}
        />
      </div>
    </div>
  );
}
