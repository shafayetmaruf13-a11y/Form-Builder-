"use client";

import { ElementView } from "@/components/renderer/element-view";
import { objectUrl } from "@/lib/storage/url";

import {
  useDragOffset,
  useElement,
  useTransformGeometry,
} from "../store/use-builder";

/**
 * One element on the builder canvas.
 *
 * This exists to own three narrow subscriptions — the element, its live move
 * offset, and its live resize/rotate geometry — so a gesture re-renders what is
 * moving and nothing else. The drawing is Slice 1's `ElementView`, unchanged:
 * the builder shows exactly what the PDF will show because it is the same
 * component.
 *
 * Moves are applied as a CSS transform and resizes as real geometry, on
 * purpose. A translate stays on the compositor and costs no layout, which is
 * what the common case deserves; a resize has to reflow the element's contents
 * anyway.
 */
export function BuilderElement({ id }: { id: string }) {
  const element = useElement(id);
  const offset = useDragOffset(id);
  const geometry = useTransformGeometry(id);

  if (!element) return null;

  const displayed = geometry ? { ...element, ...geometry } : element;

  return (
    <ElementView element={displayed} offset={offset} imageSrc={objectUrl} />
  );
}
