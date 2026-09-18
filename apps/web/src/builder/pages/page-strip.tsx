"use client";

import { PAGE_HEIGHT, PAGE_WIDTH, createPage } from "@formcraft/schema";
import { nanoid } from "nanoid";

import { PageSurface } from "@/components/renderer/page-surface";
import { objectUrl } from "@/lib/storage/url";
import { cn } from "@/lib/utils";

import {
  addPageCommand,
  movePageCommand,
  removePageCommand,
} from "../store/commands";
import {
  useActivePageId,
  useBuilderStore,
  useDocument,
} from "../store/use-builder";

/** Thumbnails are the real document, drawn small. */
const THUMBNAIL_SCALE = 0.13;

/**
 * The page strip.
 *
 * Thumbnails render through the same `PageSurface` as the canvas and the PDF,
 * at a smaller scale — not screenshots, and not a simplified preview. It is the
 * cheapest possible demonstration that the coordinate system holds, and it is
 * the mechanism Slice 3's library grid will reuse for its own thumbnails.
 */
export function PageStrip() {
  const store = useBuilderStore();
  const document = useDocument();
  const activePageId = useActivePageId();

  const pages = document.pages;

  return (
    <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-black/10 bg-neutral-50 p-2 dark:border-white/15 dark:bg-neutral-900">
      {pages.map((page, index) => {
        const isActive = page.id === activePageId;

        return (
          <div
            key={page.id}
            className="flex shrink-0 flex-col items-center gap-1"
          >
            <button
              type="button"
              aria-label={`Page ${index + 1}`}
              aria-current={isActive}
              data-page-thumb={page.id}
              onClick={() => store.setActivePage(page.id)}
              className={cn(
                "overflow-hidden rounded-sm border bg-white shadow-sm",
                isActive
                  ? "border-blue-500 ring-1 ring-blue-500"
                  : "border-black/15 hover:border-black/30 dark:border-white/20",
              )}
              style={{
                width: PAGE_WIDTH * THUMBNAIL_SCALE,
                height: PAGE_HEIGHT * THUMBNAIL_SCALE,
              }}
            >
              {/* Inert: the thumbnail is a picture of the page, not a canvas. */}
              <div className="pointer-events-none">
                <PageSurface
                  page={page}
                  scale={THUMBNAIL_SCALE}
                  imageSrc={objectUrl}
                />
              </div>
            </button>

            <div className="flex items-center gap-1 text-[10px]">
              <StripButton
                label="Move page left"
                disabled={index === 0}
                onClick={() =>
                  store.dispatch(movePageCommand(document, page.id, index - 1))
                }
              >
                ‹
              </StripButton>
              <span className="w-4 text-center opacity-60">{index + 1}</span>
              <StripButton
                label="Move page right"
                disabled={index === pages.length - 1}
                onClick={() =>
                  store.dispatch(movePageCommand(document, page.id, index + 1))
                }
              >
                ›
              </StripButton>
              <StripButton
                label="Delete page"
                // The schema requires at least one page, so the last one is not
                // something we offer to remove.
                disabled={pages.length === 1}
                onClick={() => {
                  const command = removePageCommand(document, page.id);
                  if (!command) return;
                  store.dispatch(command);
                  if (activePageId === page.id) {
                    const fallback =
                      pages[index - 1]?.id ?? pages[index + 1]?.id;
                    if (fallback) store.setActivePage(fallback);
                  }
                }}
              >
                ✕
              </StripButton>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => {
          const page = createPage(nanoid());
          store.dispatch(addPageCommand(page));
          store.setActivePage(page.id);
        }}
        className="flex shrink-0 items-center justify-center rounded-sm border border-dashed border-black/25 px-4 text-xs opacity-70 hover:opacity-100 dark:border-white/25"
        style={{ height: PAGE_HEIGHT * THUMBNAIL_SCALE }}
      >
        + Page
      </button>
    </div>
  );
}

function StripButton({
  label,
  children,
  onClick,
  disabled,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-black/10 px-1 leading-4 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-30 dark:border-white/15 dark:hover:bg-white/10"
    >
      {children}
    </button>
  );
}
