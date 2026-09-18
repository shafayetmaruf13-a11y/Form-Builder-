import type { FormDocument } from "@formcraft/schema";

import { PageSurface } from "./page-surface";

/**
 * Draws a form document, read-only.
 *
 * This is the shared read path: the builder previews through it, the public
 * fill page at Slice 4 layers live controls over the same geometry, and the
 * Slice 5 PDF worker renders it at scale 1 inside headless Chromium. Keeping
 * one renderer is what makes "the PDF matches the design" a structural
 * property rather than a thing to be tested for.
 *
 * Conditional rules are deliberately ignored here. A design preview shows what
 * was built; deciding what a filler sees is fill-time behaviour.
 */
export function FormRenderer({
  document,
  scale = 1,
  imageSrc,
}: {
  document: FormDocument;
  scale?: number;
  imageSrc?: (objectKey: string) => string;
}) {
  return (
    <div
      data-document-id={document.id}
      style={{ display: "flex", flexDirection: "column", gap: 24 * scale }}
    >
      {document.pages.map((page) => (
        <PageSurface
          key={page.id}
          page={page}
          scale={scale}
          imageSrc={imageSrc}
        />
      ))}
    </div>
  );
}
