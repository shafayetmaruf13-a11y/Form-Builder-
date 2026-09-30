import { NextResponse } from "next/server";

/** The OOXML spreadsheet media type, in full and exactly once. */
export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * A workbook as a download.
 *
 * `no-store` rather than the PDF's `private, max-age`: a PDF renders one
 * immutable version and never changes, but a form's export gains a row every
 * time somebody submits, so a cached copy is wrong within minutes.
 */
export function xlsxResponse(
  bytes: Uint8Array,
  filename: string,
): NextResponse {
  return new NextResponse(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": XLSX_CONTENT_TYPE,
      "content-length": String(bytes.byteLength),
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
