/**
 * @formcraft/schema — the single source of truth for what a form document is.
 *
 * Architecture rule 1: a form is a JSON document, not a page. The zod schema
 * that lives here is shared by the builder, the renderer, the PDF worker and
 * the API. Everything else derives from it.
 *
 * Slice 0 creates this package as an empty shell so the workspace wiring is
 * proven end to end. Slice 1 fills it in.
 */

/** A page is A4 at 96dpi. Every element's x/y/w/h is in these units. */
export const PAGE_WIDTH = 794;

/** A page is A4 at 96dpi. Every element's x/y/w/h is in these units. */
export const PAGE_HEIGHT = 1123;
