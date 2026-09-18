import { z } from "zod";

/**
 * The one coordinate system (architecture rule 2).
 *
 * A page is A4 at 96dpi. Every element's x/y/w/h is in these units, and the
 * builder canvas, the fill page and the PDF all render these same numbers at
 * different scales. Nothing downstream is allowed to invent a second system —
 * that identity is the entire reason the PDF matches the design.
 */
export const PAGE_WIDTH = 794;
export const PAGE_HEIGHT = 1123;

/** Page aspect ratio, handy for fitting a page into an arbitrary viewport. */
export const PAGE_ASPECT_RATIO = PAGE_WIDTH / PAGE_HEIGHT;

/**
 * Where an element sits on the page.
 *
 * Coordinates are deliberately unclamped: an element may be dragged partly off
 * the page in the builder, and clamping here would silently move a design
 * rather than let the renderer clip it. Width and height must be positive,
 * because a zero-area element is never intentional and renders as an invisible
 * click target.
 */
export const rectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().positive(),
  h: z.number().finite().positive(),
  /** Degrees, clockwise, about the element's centre. */
  rotation: z.number().finite().default(0),
  /** Paint order within a page. Higher is nearer the viewer. */
  z: z.number().int().default(0),
});

export type Rect = z.infer<typeof rectSchema>;
