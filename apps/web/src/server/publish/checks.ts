import {
  type FormDocument,
  danglingConditionalTargets,
  duplicateElementIds,
  inputElements,
} from "@formcraft/schema";

/**
 * What must be true before a document may be published.
 *
 * Pure, and deliberately not in `actions.ts`: a `"use server"` module may only
 * export async functions, and this is worth testing without a database.
 *
 * These are errors only at publish time. A half-built draft with a dangling
 * condition is a normal thing to have open on a Tuesday — it becomes a problem
 * the moment strangers can see it.
 */

export interface PublishProblem {
  message: string;
  /** Elements to point at, so the builder can highlight them. */
  elementIds?: string[];
}

export function publishProblems(document: FormDocument): PublishProblem[] {
  const problems: PublishProblem[] = [];

  const duplicates = duplicateElementIds(document);
  if (duplicates.length > 0) {
    problems.push({
      // Answers are keyed by element id (rule 3), so two elements sharing one
      // would overwrite each other's answers in every submission.
      message: "Two elements share an id, so their answers would collide.",
      elementIds: duplicates,
    });
  }

  const dangling = danglingConditionalTargets(document);
  if (dangling.length > 0) {
    problems.push({
      message:
        "A conditional rule points at a field that no longer exists. Fix or remove the rule.",
      elementIds: dangling.map((rule) => rule.elementId),
    });
  }

  const inputs = inputElements(document);

  if (inputs.length === 0) {
    problems.push({
      message:
        "This form has no fields to fill in, so it cannot collect anything.",
    });
  }

  const unlabelled = inputs
    .filter((element) => element.label.trim() === "")
    .map((element) => element.id);

  if (unlabelled.length > 0) {
    problems.push({
      // The quality bar says public fill pages are WCAG 2.2 AA. An unlabelled
      // control is the commonest way to fail that, and it cannot be fixed
      // after the link is circulating — the version is immutable by then.
      message: "Every field needs a label before people can fill it in.",
      elementIds: unlabelled,
    });
  }

  const emptyChoices = inputs
    .filter(
      (element) =>
        (element.type === "select" ||
          element.type === "radioGroup" ||
          element.type === "checkboxGroup") &&
        element.options.length === 0,
    )
    .map((element) => element.id);

  if (emptyChoices.length > 0) {
    problems.push({
      message: "A choice field has no options, so nobody can answer it.",
      elementIds: emptyChoices,
    });
  }

  return problems;
}

export type PublishResult =
  | { ok: true; slug: string; version: number }
  | { ok: false; problems: PublishProblem[] };
