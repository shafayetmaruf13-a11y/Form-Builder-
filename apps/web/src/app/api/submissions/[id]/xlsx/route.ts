import { type NextRequest, NextResponse } from "next/server";

import { readableSubmission } from "@/server/excel/access";
import { xlsxResponse } from "@/server/excel/response";
import { workbookFilename } from "@/server/excel/sheet-name";
import { singleSubmissionWorkbook, toBuffer } from "@/server/excel/workbook";
import { documentsForVersions } from "@/server/publish/queries";

/** One submission as a workbook, laid out like the form it came from. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const submission = await readableSubmission(id);
  // Not-found and not-permitted are the same answer.
  if (!submission) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Rule 4: built from the version it was filled against, so the questions
  // read as they did on the day.
  const documents = await documentsForVersions([submission.formVersionId]);

  const workbook = singleSubmissionWorkbook({
    formTitle: submission.formTitle,
    document: documents.get(submission.formVersionId),
    submission,
  });

  return xlsxResponse(
    await toBuffer(workbook),
    workbookFilename(submission.formTitle, submission.submittedAt),
  );
}
