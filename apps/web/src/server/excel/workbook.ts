import {
  type Answers,
  type Column,
  type FormDocument,
  columnsFor,
  flattenSubmission,
  orderedInputs,
  resolveVisibility,
  toCell,
} from "@formcraft/schema";
import ExcelJS from "exceljs";

import { sheetName } from "./sheet-name";

/**
 * Building the workbooks.
 *
 * Two shapes, because they answer two different questions. One submission is
 * read like a filled-in form — label beside value, down the page. All of them
 * are read like a table — one row each, one column per question — because that
 * is what you sort, filter and pivot.
 *
 * The flattening itself lives in `@formcraft/schema` and is pure; this file is
 * only what Excel needs on top of it.
 */

const HEADER_FILL = "FFF1F5F9";
const RETIRED_FILL = "FFFEF3C7";
const DATE_FORMAT = "yyyy-mm-dd";
const TIMESTAMP_FORMAT = "yyyy-mm-dd hh:mm";

/**
 * A published version's document, with the version it came from.
 *
 * The pairing has to be carried explicitly: a `FormDocument`'s own `id` is the
 * *form's* id and is identical in every version, so a document cannot say
 * which version it is.
 */
export interface VersionedDocument {
  formVersionId: string;
  version: number;
  document: FormDocument;
}

export interface SubmissionRecord {
  id: string;
  submittedAt: Date;
  version: number;
  formVersionId: string;
  answers: Answers;
}

function newWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Formcraft";
  workbook.created = new Date();
  return workbook;
}

/**
 * Every submission to a form, as one table.
 *
 * `versions` is newest first: column order follows it, and the newest
 * version's own layout is the one a reader recognises.
 */
export function submissionsWorkbook({
  formTitle,
  versions,
  submissions,
}: {
  formTitle: string;
  versions: readonly VersionedDocument[];
  submissions: readonly SubmissionRecord[];
}): ExcelJS.Workbook {
  const workbook = newWorkbook();
  const sheet = workbook.addWorksheet(sheetName(formTitle));

  const columns = columnsFor(versions.map((entry) => entry.document));
  const documentFor = new Map(
    versions.map((entry) => [entry.formVersionId, entry.document]),
  );

  // Metadata first, so a row identifies itself before it answers anything.
  // `Version` earns its place: it is how a reader makes sense of a blank in a
  // retired column.
  const header = [
    "Submitted",
    "Version",
    "Submission ID",
    ...columns.map((column) => column.header),
  ];
  const META = 3;

  sheet.columns = header.map((name, index) => ({
    header: name,
    key: String(index),
    width:
      index < META
        ? [20, 9, 24][index]
        : widthFor(columns[index - META] as Column),
  }));

  for (const submission of submissions) {
    sheet.addRow([
      submission.submittedAt,
      submission.version,
      submission.id,
      ...flattenSubmission(
        columns,
        documentFor.get(submission.formVersionId),
        submission.answers,
      ),
    ]);
  }

  styleTable(sheet, columns, META);
  return workbook;
}

/**
 * One submission, laid out like the form it came from.
 *
 * Questions in reading order with their answers beside them, which is what
 * somebody wants when looking at a single response rather than analysing a
 * hundred.
 */
export function singleSubmissionWorkbook({
  formTitle,
  document,
  submission,
}: {
  formTitle: string;
  document: FormDocument | undefined;
  submission: SubmissionRecord;
}): ExcelJS.Workbook {
  const workbook = newWorkbook();
  const sheet = workbook.addWorksheet(sheetName(formTitle, "Response"));

  sheet.columns = [
    { header: "Question", key: "q", width: 38 },
    { header: "Answer", key: "a", width: 52 },
  ];

  sheet.addRow(["Submitted", submission.submittedAt]);
  sheet.addRow(["Version", submission.version]);
  sheet.addRow(["Submission ID", submission.id]);
  sheet.addRow([]);

  // Hidden fields are left out, exactly as the PDF leaves them out: a
  // condition meant the question was never asked, and a blank answer beside it
  // would claim it went unanswered.
  //
  // The all-submissions sheet cannot do this — a column has to exist if *any*
  // row answered it — which is what the Version column and the tinted retired
  // headers are there to explain.
  const visibility = document
    ? resolveVisibility(document, submission.answers)
    : null;

  const inputs = document
    ? orderedInputs(document).filter(
        (element) => visibility?.visible.has(element.id) ?? true,
      )
    : [];

  for (const element of inputs) {
    sheet.addRow([
      element.label.trim() || element.id,
      toCell(element, submission.answers[element.id]),
    ]);
  }

  // An answer whose question is not in this version's document. Possible if a
  // stored row outlived its schema — reported rather than dropped, because a
  // silently missing answer is not something anybody notices.
  const known = new Set(inputs.map((element) => element.id));
  const orphans = Object.keys(submission.answers).filter(
    (id) => !known.has(id),
  );

  if (orphans.length > 0) {
    sheet.addRow([]);
    sheet.addRow(["Answers with no matching question", ""]);
    for (const id of orphans) {
      sheet.addRow([id, toCell(undefined, submission.answers[id])]);
    }
  }

  styleKeyValue(sheet);
  return workbook;
}

export async function toBuffer(
  workbook: ExcelJS.Workbook,
): Promise<Uint8Array> {
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function widthFor(column: Column | undefined): number {
  switch (column?.type) {
    case "textarea":
      return 46;
    case "checkboxGroup":
    case "fileUpload":
      return 30;
    case "checkbox":
      return 12;
    case "number":
    case "date":
      return 14;
    default:
      return Math.min(40, Math.max(16, (column?.header.length ?? 12) + 4));
  }
}

function styleTable(
  sheet: ExcelJS.Worksheet,
  columns: readonly Column[],
  meta: number,
) {
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 28;

  for (let i = 1; i <= sheet.columnCount; i++) {
    const column = columns[i - 1 - meta];

    header.getCell(i).fill = {
      type: "pattern",
      pattern: "solid",
      // A retired column is tinted, because a reader seeing a column of blanks
      // deserves to know the question stopped being asked rather than that
      // everybody declined to answer it.
      fgColor: { argb: column?.retired ? RETIRED_FILL : HEADER_FILL },
    };

    if (column?.retired) {
      header.getCell(i).note = "This field is not in the latest version.";
    }
    if (column?.type === "date") sheet.getColumn(i).numFmt = DATE_FORMAT;
  }

  sheet.getColumn(1).numFmt = TIMESTAMP_FORMAT;

  // The header stays put while scrolling and every column gets a filter — the
  // two things that make a sheet of a thousand rows usable.
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columnCount },
  };
}

function styleKeyValue(sheet: ExcelJS.Worksheet) {
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: HEADER_FILL },
  };

  sheet.getColumn(1).font = { bold: true };
  sheet.getColumn(2).alignment = { wrapText: true, vertical: "top" };

  sheet.eachRow((row) => {
    if (row.getCell(2).value instanceof Date) {
      row.getCell(2).numFmt = DATE_FORMAT;
    }
  });

  // The submitted-at row carries a time as well as a date.
  sheet.getCell("B2").numFmt = TIMESTAMP_FORMAT;
}
