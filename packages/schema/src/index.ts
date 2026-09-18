/**
 * @formcraft/schema — the single source of truth for what a form document is.
 *
 * Architecture rule 1: a form is a JSON document, not a page. The zod schemas
 * here are shared by the builder, the renderer, the PDF worker and the API.
 * Everything else derives from them. Nothing downstream may define its own
 * notion of an element, a style or a page coordinate.
 */

export * from "./geometry";
export * from "./style";
export * from "./elements";
export * from "./document";
export * from "./operations";
export * from "./defaults";
export * from "./fixtures";
