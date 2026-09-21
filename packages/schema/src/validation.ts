import {
  type Answer,
  type AnswerFile,
  type Answers,
  answerToString,
  isRequiredSatisfied,
} from "./answers";
import { pruneHiddenAnswers, resolveVisibility } from "./conditions";
import type { FormDocument } from "./document";
import { type InputElement, isInputElement } from "./elements";

/**
 * Whether a set of answers is acceptable.
 *
 * Architecture rule 5: the client validates for the sake of the person filling
 * the form, and the server validates because the client's opinion is not
 * evidence. Both call this, so they cannot disagree.
 *
 * Only *visible* fields are checked. A required question that a condition has
 * hidden is not unanswered — it was never asked.
 */

/**
 * Ceiling on a signature data URL.
 *
 * A 600x180 canvas of ink encodes well under this; anything far larger is not
 * a signature, and jsonb is not a file store.
 */
export const MAX_SIGNATURE_CHARS = 250_000;

export interface FieldError {
  elementId: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: FieldError[];
  /** Answers with hidden fields removed. What should actually be stored. */
  answers: Answers;
}

export function validateAnswers(
  document: FormDocument,
  submitted: Answers,
): ValidationResult {
  const { visible } = resolveVisibility(document, submitted);
  const kept = pruneHiddenAnswers(document, submitted);
  const errors: FieldError[] = [];
  const answers: Answers = {};

  for (const page of document.pages) {
    for (const element of page.elements) {
      if (!isInputElement(element)) continue;
      if (!visible.has(element.id)) continue;

      // Built up from the document rather than filtered down from the request,
      // so a key that is not a question in this form cannot reach storage —
      // whether it came from a tampered request or a tab open since before an
      // edit. Rule 5: the request says what was answered, the document says
      // what was asked.
      const answer = kept[element.id];
      if (answer !== undefined) answers[element.id] = answer;

      const error = validateField(element, answer);
      if (error) errors.push({ elementId: element.id, message: error });
    }
  }

  return { ok: errors.length === 0, errors, answers };
}

/** The first thing wrong with one answer, or null. */
export function validateField(
  element: InputElement,
  answer: Answer | undefined,
): string | null {
  if (element.required && !isRequiredSatisfied(element, answer)) {
    return element.type === "checkbox"
      ? "This must be ticked"
      : "This is required";
  }

  // Everything below only applies to an answer that was actually given. An
  // optional field left blank is not "too short".
  const given = answer !== undefined && answer !== null && answer !== "";
  if (!given) return null;

  const rules = element.validation ?? {};

  switch (element.type) {
    case "textInput":
    case "textarea": {
      const text = answerToString(answer);

      if (rules.minLength !== undefined && text.length < rules.minLength) {
        return `Must be at least ${rules.minLength} characters`;
      }
      if (rules.maxLength !== undefined && text.length > rules.maxLength) {
        return `Must be at most ${rules.maxLength} characters`;
      }
      if (rules.pattern !== undefined && !matches(rules.pattern, text)) {
        return "That is not in the expected format";
      }
      if (element.type === "textInput" && element.inputType === "email") {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
          return "That does not look like an email address";
        }
      }
      if (element.type === "textInput" && element.inputType === "url") {
        // Deliberately a pattern rather than `new URL(...)`: this package has
        // no DOM or Node lib, because the builder, the server and the PDF
        // worker all import it and none of them may assume the others' globals.
        if (!/^https?:\/\/[^\s/?#.]+\.[^\s]*$/i.test(text)) {
          return "That does not look like a web address";
        }
      }
      return null;
    }

    case "number": {
      const value =
        typeof answer === "number" ? answer : Number(answerToString(answer));
      if (!Number.isFinite(value)) return "That is not a number";
      if (rules.min !== undefined && value < rules.min) {
        return `Must be at least ${rules.min}`;
      }
      if (rules.max !== undefined && value > rules.max) {
        return `Must be at most ${rules.max}`;
      }
      return null;
    }

    case "date": {
      const text = answerToString(answer);
      // ISO date, because that is what survives a jsonb round trip unambiguously.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
        return "That is not a valid date";
      }
      if (rules.minDate !== undefined && text < rules.minDate) {
        return `Must be on or after ${rules.minDate}`;
      }
      if (rules.maxDate !== undefined && text > rules.maxDate) {
        return `Must be on or before ${rules.maxDate}`;
      }
      return null;
    }

    case "select":
    case "radioGroup": {
      // An answer not among the options means the page was tampered with, or
      // the form changed underneath somebody.
      const allowed = element.options.map((option) => option.value);
      if (!allowed.includes(answerToString(answer))) {
        return "That is not one of the choices";
      }
      return null;
    }

    case "checkboxGroup": {
      if (!Array.isArray(answer)) return "That is not a valid selection";
      const chosen = items(answer).map((item) =>
        typeof item === "string" ? item : item.filename,
      );
      const allowed = new Set(element.options.map((option) => option.value));

      if (chosen.some((value) => !allowed.has(value))) {
        return "That is not one of the choices";
      }
      if (new Set(chosen).size !== chosen.length) {
        return "The same choice was selected twice";
      }
      if (
        rules.minSelected !== undefined &&
        chosen.length < rules.minSelected
      ) {
        return `Choose at least ${rules.minSelected}`;
      }
      if (
        rules.maxSelected !== undefined &&
        chosen.length > rules.maxSelected
      ) {
        return `Choose at most ${rules.maxSelected}`;
      }
      return null;
    }

    case "fileUpload": {
      if (!Array.isArray(answer)) return "That is not a valid upload";
      const files = items(answer).filter(
        (item): item is AnswerFile => typeof item !== "string",
      );

      if (!element.multiple && files.length > 1) {
        return "Only one file is allowed";
      }
      for (const file of files) {
        if (
          rules.maxSizeBytes !== undefined &&
          file.byteSize > rules.maxSizeBytes
        ) {
          return `Each file must be under ${Math.round(rules.maxSizeBytes / 1_000_000)} MB`;
        }
        if (rules.acceptedTypes?.length) {
          const ok = rules.acceptedTypes.some(
            (accepted) =>
              accepted === file.contentType ||
              (accepted.startsWith(".") &&
                file.filename.toLowerCase().endsWith(accepted.toLowerCase())),
          );
          if (!ok) return "That file type is not accepted";
        }
      }
      return null;
    }

    case "signature": {
      // A PNG data URL, drawn on a canvas. It arrives as a string from an
      // untrusted page, so it is bounded and its prefix is checked — otherwise
      // this field is an arbitrary-blob upload with no size limit that happens
      // to land in jsonb.
      const text = answerToString(answer);

      if (!text.startsWith("data:image/png;base64,")) {
        return "That is not a valid signature";
      }
      if (text.length > MAX_SIGNATURE_CHARS) {
        return "That signature is too large";
      }
      return null;
    }

    case "checkbox":
      return null;

    default: {
      const exhaustive: never = element;
      return exhaustive;
    }
  }
}

/**
 * An array answer as one list.
 *
 * `Answer`'s array arm is `string[] | AnswerFile[]`, and TypeScript refuses
 * `.map` on a union of array types — the call signatures don't unify. Widening
 * once here is cheaper than narrowing at every use.
 */
function items(answer: readonly string[] | readonly AnswerFile[]) {
  return answer as readonly (string | AnswerFile)[];
}

/**
 * Tests a stored pattern.
 *
 * The pattern comes from a form designer, is stored in a document, and is run
 * here — so a bad one must not take the request down. It is also anchored, so
 * "abc" does not satisfy a pattern meant to describe the whole value.
 */
function matches(pattern: string, value: string): boolean {
  try {
    return new RegExp(`^(?:${pattern})$`).test(value);
  } catch {
    // An unparseable pattern cannot reject anything; the alternative is
    // rejecting every answer to that field forever.
    return true;
  }
}
