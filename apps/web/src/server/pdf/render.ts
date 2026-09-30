import { PAGE_HEIGHT, PAGE_WIDTH } from "@formcraft/schema";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { submissions } from "@/db/schema";
import { getStorage } from "@/lib/storage";

import { getBrowser } from "./browser";
import { submissionPdfKey } from "./keys";
import { renderOrigin, renderToken } from "./render-token";

/**
 * Rendering a submission to PDF.
 *
 * The promise this whole architecture exists to keep: filled values appear
 * exactly where the designer put the fields. It is kept by not being clever —
 * the same `PageSurface` at scale 1, photographed at the document's own pixel
 * dimensions.
 *
 * On demand rather than on submit. Coupling the public submit endpoint to a
 * Chromium launch would make the one endpoint strangers can reach the slowest
 * and most memory-hungry thing in the app, which is a denial of service with a
 * feature attached. Slice 8 calls `renderSubmissionPdf` from its own path.
 */

/** How long a single page may take before the attempt is abandoned. */
const NAVIGATION_TIMEOUT_MS = 20_000;

export interface RenderedPdf {
  objectKey: string;
  bytes: Uint8Array;
  /** False when the PDF was already in storage and was not re-rendered. */
  rendered: boolean;
}

/**
 * Returns the submission's PDF, rendering it if it is not already stored.
 *
 * Cached by (submission, version), which is safe precisely because a version
 * is immutable: there is no edit that could make a stored PDF wrong. That is
 * rule 4 paying for itself — without it, every download would have to
 * re-render to be trustworthy.
 */
export async function getOrRenderSubmissionPdf(
  submissionId: string,
): Promise<RenderedPdf | null> {
  const [row] = await db
    .select({
      id: submissions.id,
      formVersionId: submissions.formVersionId,
      pdfObjectKey: submissions.pdfObjectKey,
    })
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1);

  if (!row) return null;

  const objectKey = submissionPdfKey(row.id, row.formVersionId);
  const storage = getStorage();

  if (row.pdfObjectKey) {
    const stored = await storage.get(row.pdfObjectKey);
    // A key recorded but absent means storage was cleared underneath us — a
    // local `.uploads` wiped, a bucket lifecycle rule. Re-render rather than
    // hand back a 404 for a submission that plainly exists.
    if (stored) {
      return {
        objectKey: row.pdfObjectKey,
        bytes: stored.bytes,
        rendered: false,
      };
    }
  }

  const bytes = await renderSubmissionPdf(submissionId);
  await storage.put(objectKey, bytes, "application/pdf");

  await db
    .update(submissions)
    .set({ pdfObjectKey: objectKey })
    .where(eq(submissions.id, submissionId));

  return { objectKey, bytes, rendered: true };
}

/**
 * Renders a submission, always. Does not read or write storage.
 *
 * Separate from the caching wrapper so the Slice 8 email path and any future
 * "re-render this" can reuse it, and so a test can exercise the rendering
 * without a database write.
 */
export async function renderSubmissionPdf(
  submissionId: string,
): Promise<Uint8Array> {
  const browser = await getBrowser();
  const url = `${renderOrigin()}/internal/render/${encodeURIComponent(
    submissionId,
  )}?token=${encodeURIComponent(renderToken(submissionId))}`;

  // A fresh context per render: no cookies, no storage, nothing carried from
  // one submission's render into another's.
  const context = await browser.newContext({
    viewport: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    // 1 document unit = 1 CSS pixel = 1/96 inch. Rule 2's coordinate system is
    // only exact if nothing scales it.
    deviceScaleFactor: 1,
    // The page is entirely our own content; a locale-dependent date or number
    // format would make the same submission render differently per machine.
    locale: "en-GB",
    timezoneId: "UTC",
  });

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);

    const response = await page.goto(url, {
      // Fonts and the logo have to be in before the photograph. `load` covers
      // stylesheets and images; `networkidle` would also wait for anything
      // long-polling, which in a dev server means waiting forever.
      waitUntil: "load",
      timeout: NAVIGATION_TIMEOUT_MS,
    });

    if (!response || !response.ok()) {
      throw new Error(
        `render page returned ${response?.status() ?? "no response"} for ${submissionId}`,
      );
    }

    // The marker the render page emits. Without this a page that failed
    // half-way through could be photographed as though it were finished.
    await page.waitForSelector("#render-ready", {
      state: "attached",
      timeout: NAVIGATION_TIMEOUT_MS,
    });

    // `document.fonts.ready` is the only reliable signal that text has been
    // laid out in the intended face rather than a fallback. Without it the
    // first render after a cold start can come out in Times.
    await page.evaluate(() => globalThis.document.fonts.ready);

    const pdf = await page.pdf({
      // Inches, and stated here rather than left to CSS.
      //
      // A PDF page box is in points, and 1in is exactly 72pt, so inches are
      // the one accepted unit that converts without rounding: 794px / 96dpi
      // is 8.2708333in is exactly 595.5pt.
      //
      // Two things that do not work, both tried: `794px` yields a
      // 794.56x1122.56px box — a fraction *shorter* than the page — so a
      // one-page form prints as two, with a sliver of nothing on the second;
      // and `preferCSSPageSize` with an `@page` size did not reach Chromium's
      // print path at all, leaving it on its own A4 default.
      // `format: "A4"` is wrong by definition: 210x297mm is not 794x1123px.
      width: `${(PAGE_WIDTH / 96).toFixed(9)}in`,
      height: `${(PAGE_HEIGHT / 96).toFixed(9)}in`,
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      // The design is the whole document; a header or footer would be content
      // the designer never placed.
      displayHeaderFooter: false,
      scale: 1,
    });

    return new Uint8Array(pdf);
  } finally {
    // Always: a leaked context holds a renderer process open, and enough of
    // them is the box falling over.
    await context.close();
  }
}
