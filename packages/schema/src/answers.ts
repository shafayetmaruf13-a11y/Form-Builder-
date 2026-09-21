import { z } from "zod";

import type { FormDocument } from "./document";
import { type InputElement, isInputElement } from "./elements";

/**
 * What a filled-in form holds.
 *
 * Answers are keyed by element id, never by label (architecture rule 3), so
 * renaming a field in a later version never orphans a historical answer.
 *
 * The shape an answer takes depends on the element type, and every one of them
 * has to survive a jsonb round trip — which is why a date is an ISO string and
 * an uploaded file is an object key, not a `Date` or a `File`.
 */

/** A single uploaded file, as stored in an answer. */
export const answerFileSchema = z.object({
  objectKey: z.string(),
  filename: z.string(),
  contentType: z.string(),
  byteSize: z.number().int().nonnegative(),
});

export type AnswerFile = z.infer<typeof answerFileSchema>;

export const answerSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.array(answerFileSchema),
  z.null(),
]);

export type Answer = z.infer<typeof answerSchema>;

/** Everything somebody filled in, keyed by element id. */
export const answersSchema = z.record(z.string(), answerSchema);
export type Answers = z.infer<typeof answersSchema>;

/**
 * The empty answer for an element type.
 *
 * Distinct from "not answered": a checkbox group's empty answer is `[]`, not
 * `null`, so the difference between "chose nothing" and "never saw the field"
 * stays visible.
 */
export function emptyAnswer(element: InputElement): Answer {
  switch (element.type) {
    case "checkbox":
      return false;
    case "checkboxGroup":
    case "fileUpload":
      return [];
    case "number":
      return null;
    default:
      return "";
  }
}

/** A blank answer set for a document: every input, nothing filled in. */
export function emptyAnswers(document: FormDocument): Answers {
  const answers: Answers = {};

  for (const page of document.pages) {
    for (const element of page.elements) {
      if (isInputElement(element)) answers[element.id] = emptyAnswer(element);
    }
  }

  return answers;
}

/**
 * Whether an answer counts as "given".
 *
 * Used by required-field checks and by the `isEmpty` condition, so that both
 * agree on what empty means. `false` is a real answer to a checkbox — it is
 * "no", not "unanswered" — but an unticked *required* checkbox still has to
 * fail, which `isRequiredSatisfied` handles separately rather than by
 * pretending `false` is empty.
 */
export function isAnswered(answer: Answer | undefined): boolean {
  if (answer === undefined || answer === null) return false;
  if (typeof answer === "string") return answer.trim() !== "";
  if (Array.isArray(answer)) return answer.length > 0;
  return true;
}

/** Whether a required element's answer satisfies it. */
export function isRequiredSatisfied(
  element: InputElement,
  answer: Answer | undefined,
): boolean {
  // A required checkbox means "you must tick this" — a consent box. `false`
  // is a given answer but not an acceptable one.
  if (element.type === "checkbox") return answer === true;
  return isAnswered(answer);
}

/** An answer as text, for conditions, Excel columns and the PDF. */
export function answerToString(answer: Answer | undefined): string {
  if (answer === undefined || answer === null) return "";
  if (typeof answer === "boolean") return answer ? "true" : "false";
  if (typeof answer === "number") return String(answer);
  if (typeof answer === "string") return answer;

  return answer
    .map((item) => (typeof item === "string" ? item : item.filename))
    .join(", ");
}
