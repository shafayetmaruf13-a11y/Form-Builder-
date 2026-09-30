import {
  type Answer,
  type AnswerFile,
  type Answers,
  answerToString,
} from "./answers";
import type { FormDocument } from "./document";
import { type InputElement, isInputElement } from "./elements";

/**
 * Turning documents and answers into rows and columns.
 *
 * A form is a free canvas, so it has no natural column order and no natural
 * notion of a row. This is where one is imposed, and it is pure so it can be
 * tested exhaustively — the brief names Excel flattening as one of the three
 * things that must be.
 *
 * The hard part is not a single submission. It is that submissions span
 * versions (rule 4), and a version may add, remove or rename fields. Columns
 * are therefore keyed by **element id**, never by label (rule 3): a rename is
 * the same column with a new heading, not a second column with half the data.
 */

/** A cell value, in the types a spreadsheet actually understands. */
export type CellValue = string | number | boolean | Date | null;

export interface Column {
  /** The element this column reports. Stable across versions. */
  elementId: string;
  /** The most recent label this element had, for the header. */
  header: string;
  type: InputElement["type"];
  /**
   * True when the element is absent from the newest version.
   *
   * The caller can mark these, because a reader seeing a column of mostly
   * blanks deserves to know the question stopped being asked rather than
   * that everybody declined to answer.
   */
  retired: boolean;
}

/**
 * The columns for a set of versions, newest first.
 *
 * `documents` must be ordered newest version first. The newest version's
 * fields come first and in its own canvas order; anything that only exists in
 * older versions follows, marked retired. That way the common case — one
 * version, or a form whose fields barely changed — reads exactly as the
 * designer laid it out.
 */
export function columnsFor(documents: readonly FormDocument[]): Column[] {
  const columns: Column[] = [];
  const seen = new Set<string>();
  let first = true;

  for (const document of documents) {
    for (const element of orderedInputs(document)) {
      if (seen.has(element.id)) continue;

      seen.add(element.id);
      columns.push({
        elementId: element.id,
        // The first document to mention it is the newest one that has it, so
        // this is the most recent label the field ever carried.
        header: element.label.trim() || element.id,
        type: element.type,
        retired: !first,
      });
    }
    first = false;
  }

  return columns;
}

/**
 * Input elements in the order a person reads the page: top to bottom, then
 * left to right, across pages.
 *
 * Not `z`, which is paint order and says nothing about reading order, and not
 * document order, which is the order the designer happened to drag things out.
 * Rows within about a line of each other count as the same row, so two fields
 * side by side come out left-then-right rather than by a stray pixel.
 */
export function orderedInputs(document: FormDocument): InputElement[] {
  const ROW_TOLERANCE = 24;

  return document.pages.flatMap((page) =>
    page.elements
      .filter((element): element is InputElement => isInputElement(element))
      .slice()
      .sort((a, b) => {
        if (Math.abs(a.y - b.y) > ROW_TOLERANCE) return a.y - b.y;
        return a.x - b.x;
      }),
  );
}

/**
 * One answer as a spreadsheet cell.
 *
 * Numbers and dates come back as numbers and dates, not text. This is the
 * difference between a spreadsheet and a CSV that has been renamed: a column
 * of text dates sorts alphabetically, and `=SUM()` over text is zero.
 *
 * `element` may be undefined when a submission was filled against a version
 * that had this field and the column's own document does not — the answer is
 * still reported, as text, rather than dropped.
 */
export function toCell(
  element: InputElement | undefined,
  answer: Answer | undefined,
): CellValue {
  if (answer === undefined || answer === null) return null;

  if (!element) return answerToString(answer) || null;

  switch (element.type) {
    case "number": {
      // Arrives as a string from a form post; stored as whatever was sent.
      const value = typeof answer === "number" ? answer : Number(answer);
      return Number.isFinite(value) ? value : answerToString(answer) || null;
    }

    case "date": {
      const text = answerToString(answer);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || null;

      // Parsed as UTC midnight. A local-midnight Date would shift the day
      // backwards for anybody west of Greenwich when Excel renders it.
      const date = new Date(`${text}T00:00:00Z`);
      return Number.isNaN(date.getTime()) ? text : date;
    }

    case "checkbox":
      // A real boolean, so a filter offers TRUE/FALSE rather than two strings.
      return answer === true;

    case "select":
    case "radioGroup": {
      // The label, not the stored value: a sheet is read by people, and
      // "United Kingdom" is the answer somebody gave, while "gb" is a detail
      // of how it is stored.
      const value = answerToString(answer);
      if (value === "") return null;
      return labelOf(element, value);
    }

    case "checkboxGroup": {
      const chosen = asStrings(answer);
      if (chosen.length === 0) return null;
      return chosen.map((value) => labelOf(element, value)).join(", ");
    }

    case "fileUpload": {
      const files = asFiles(answer);
      if (files.length === 0) return null;
      // Filenames. The bytes cannot go in a cell, and an object key would be
      // meaningless to whoever opens the sheet.
      return files.map((file) => file.filename).join(", ");
    }

    case "signature": {
      const text = answerToString(answer);
      // Never the data URL: 15KB of base64 in a cell is unusable, and an
      // embedded image would make the row unsortable.
      return text.startsWith("data:image/") ? "(signed)" : null;
    }

    default: {
      const text = answerToString(answer);
      return text === "" ? null : text;
    }
  }
}

/** One submission as a row, in the columns' order. */
export function flattenSubmission(
  columns: readonly Column[],
  document: FormDocument | undefined,
  answers: Answers,
): CellValue[] {
  const byId = new Map<string, InputElement>(
    document ? inputsById(document) : [],
  );

  return columns.map((column) =>
    toCell(byId.get(column.elementId), answers[column.elementId]),
  );
}

function inputsById(document: FormDocument): [string, InputElement][] {
  return document.pages
    .flatMap((page) => page.elements)
    .filter((element): element is InputElement => isInputElement(element))
    .map((element) => [element.id, element]);
}

/** An option's label, falling back to the raw value if it is not one. */
function labelOf(
  element: Extract<
    InputElement,
    { type: "select" | "radioGroup" | "checkboxGroup" }
  >,
  value: string,
): string {
  return (
    element.options.find((option) => option.value === value)?.label ?? value
  );
}

function asStrings(answer: Answer): string[] {
  if (!Array.isArray(answer)) return [];
  return answer.filter((item): item is string => typeof item === "string");
}

function asFiles(answer: Answer): AnswerFile[] {
  if (!Array.isArray(answer)) return [];
  return answer.filter((item): item is AnswerFile => typeof item !== "string");
}
