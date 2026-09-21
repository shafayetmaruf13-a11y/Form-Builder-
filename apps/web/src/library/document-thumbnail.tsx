import { PAGE_HEIGHT, PAGE_WIDTH, type FormDocument } from "@formcraft/schema";

import { PageSurface } from "@/components/renderer/page-surface";
import { objectUrl } from "@/lib/storage/url";

/**
 * A form's first page, drawn small.
 *
 * Rendered from the document through the same `PageSurface` the canvas and the
 * PDF use — not a stored screenshot. So a thumbnail is never stale, there is no
 * image pipeline to run, and what the library shows is by construction what the
 * form actually is.
 *
 * A server component: it has no interactivity, so it costs the client nothing
 * but markup.
 */
export function DocumentThumbnail({
  document,
  width = 180,
}: {
  document: FormDocument;
  width?: number;
}) {
  const scale = width / PAGE_WIDTH;
  const page = document.pages[0];

  if (!page) return null;

  return (
    <div
      className="overflow-hidden rounded-sm bg-white"
      style={{ width, height: PAGE_HEIGHT * scale }}
    >
      <div className="pointer-events-none">
        <PageSurface page={page} scale={scale} imageSrc={objectUrl} />
      </div>
    </div>
  );
}
