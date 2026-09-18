"use client";

import { ElementView } from "@/components/renderer/element-view";

import { useDragOffset, useElement } from "../store/use-builder";

/**
 * One element on the builder canvas.
 *
 * This exists purely to own two narrow subscriptions — this element, and this
 * element's live drag offset — so that dragging re-renders the elements that
 * are moving and nothing else. The drawing itself is Slice 1's `ElementView`,
 * unchanged: the builder shows exactly what the PDF will show because it is
 * the same component.
 */
export function BuilderElement({ id }: { id: string }) {
  const element = useElement(id);
  const offset = useDragOffset(id);

  if (!element) return null;

  return <ElementView element={element} offset={offset} />;
}
