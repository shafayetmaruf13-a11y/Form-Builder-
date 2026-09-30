import { answersSchema } from "@formcraft/schema";
import { type NextRequest, NextResponse } from "next/server";

import { readableForm } from "@/server/excel/access";
import { xlsxResponse } from "@/server/excel/response";
import { workbookFilename } from "@/server/excel/sheet-name";
import { submissionsWorkbook, toBuffer } from "@/server/excel/workbook";
import { listSubmissions, versionedDocuments } from "@/server/publish/queries";

/**
 * Every response to a form, as one sheet.
 *
 * Columns are the union of every version's input elements, keyed by element id
 * — so a renamed field stays one column and a field removed in a later version
 * still reports the answers it collected. Dropping those would be data loss in
 * the one place that is a record.
 */

/** A ceiling, so one request cannot try to build a workbook of everything. */
const MAX_ROWS = 10_000;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const form = await readableForm(id);
  if (!form) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [versions, rows] = await Promise.all([
    versionedDocuments(id),
    listSubmissions(id, MAX_ROWS),
  ]);

  const workbook = submissionsWorkbook({
    formTitle: form.title,
    versions,
    submissions: rows.map((row) => {
      const answers = answersSchema.safeParse(row.answers ?? {});
      return {
        id: row.id,
        submittedAt: row.submittedAt,
        version: row.version,
        formVersionId: row.formVersionId,
        answers: answers.success ? answers.data : {},
      };
    }),
  });

  return xlsxResponse(
    await toBuffer(workbook),
    workbookFilename(form.title, new Date()),
  );
}
