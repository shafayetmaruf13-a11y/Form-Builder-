/**
 * The URL a stored object is served from.
 *
 * Deliberately its own module, with no imports. The builder canvas and the page
 * thumbnails are client components and need this; the storage implementations
 * next door reach for `node:fs`, and importing them from the browser bundle
 * fails the build.
 *
 * It lives here rather than in the document because a document stores an
 * `objectKey` and nothing more. Architecture rule 4 says a version published
 * today must still render years from now — baking a hostname into it would
 * break that the first time the bucket moves.
 */
export function objectUrl(objectKey: string): string {
  return `/api/uploads/${encodeURIComponent(objectKey)}`;
}
