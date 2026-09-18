import { PAGE_HEIGHT, PAGE_WIDTH, type Page } from "@formcraft/schema";

import { ElementView } from "./element-view";

/**
 * One A4 page, drawn at a given scale.
 *
 * The scale is applied exactly once, as a CSS transform on the page itself.
 * Everything inside is laid out at raw document coordinates and never learns
 * what scale it is at. That is the whole of architecture rule 2: the builder
 * passes 0.8, a thumbnail passes 0.2, the PDF worker passes 1, and none of
 * them can drift from each other because there is only one layout path.
 */
export function PageSurface({
  page,
  scale = 1,
  imageSrc,
}: {
  page: Page;
  scale?: number;
  imageSrc?: (objectKey: string) => string;
}) {
  // Painting order is z, then document order for ties — a stable sort keeps
  // equal-z elements in the order the designer added them.
  const elements = [...page.elements].sort((a, b) => a.z - b.z);

  return (
    <div
      // The outer box occupies the *scaled* footprint, so surrounding layout
      // reserves the right amount of space. A CSS transform alone would not.
      style={{
        width: PAGE_WIDTH * scale,
        height: PAGE_HEIGHT * scale,
        overflow: "hidden",
        flex: "none",
      }}
    >
      <div
        data-page-id={page.id}
        style={{
          position: "relative",
          width: PAGE_WIDTH,
          height: PAGE_HEIGHT,
          backgroundColor: page.background,
          transform: scale === 1 ? undefined : `scale(${scale})`,
          transformOrigin: "top left",
          overflow: "hidden",
        }}
      >
        {elements.map((element) => (
          <ElementView key={element.id} element={element} imageSrc={imageSrc} />
        ))}
      </div>
    </div>
  );
}
