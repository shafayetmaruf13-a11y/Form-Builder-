import {
  type Answer,
  type Answers,
  answerToString,
  isAnswered,
} from "./answers";
import type { FormDocument } from "./document";
import {
  type Conditional,
  type FormElement,
  type InputElement,
  isInputElement,
} from "./elements";

/**
 * Conditional visibility at fill time.
 *
 * A rule reads "show this if <targetId> <operator> <value>". The builder stores
 * them; this is where they mean something.
 *
 * Two properties matter more than the operators themselves:
 *
 *   - **A hidden field's answer is discarded and never validated.** Otherwise a
 *     required field nobody can see blocks the form forever, and answers people
 *     typed before a condition turned against them get submitted invisibly.
 *   - **Visibility settles.** Hiding A can hide B that depends on A, so it is
 *     resolved to a fixed point rather than in one pass — and a cycle stops
 *     rather than hanging.
 */

/** Compares one answer against a condition's operand. */
export function evaluateCondition(
  condition: Conditional,
  answer: Answer | undefined,
): boolean {
  const { operator, value } = condition;

  if (operator === "isEmpty") return !isAnswered(answer);
  if (operator === "isNotEmpty") return isAnswered(answer);

  // Numeric comparisons only mean anything on numbers. Comparing strings with
  // `>` would make "10" < "9", which is never what a form designer meant.
  if (operator === "greaterThan" || operator === "lessThan") {
    const left = toNumber(answer);
    const right = toNumber(value);
    if (left === null || right === null) return false;
    return operator === "greaterThan" ? left > right : left < right;
  }

  const operand = answerToString(value as Answer);

  if (operator === "contains" || operator === "notContains") {
    // A multi-select contains an option exactly; text contains a substring.
    const hit = Array.isArray(answer)
      ? answer.some(
          (item) =>
            (typeof item === "string" ? item : item.filename) === operand,
        )
      : answerToString(answer).toLowerCase().includes(operand.toLowerCase());

    return operator === "contains" ? hit : !hit;
  }

  // equals / notEquals. Compared as text so that a select's value, a number and
  // a checkbox all behave the way somebody typing into the builder expects.
  const same = answerToString(answer) === operand;
  return operator === "equals" ? same : !same;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Elements caught in a circular dependency.
 *
 * Each conditioned element points at exactly one target, so the dependency
 * graph has out-degree one and a cycle is found by walking the chain from each
 * node until it repeats.
 *
 * Worth detecting explicitly rather than relying on the fixed point to give up:
 * two fields conditioned on each other *settle* perfectly well at "both
 * hidden", so no loop ever happens — the questions just quietly disappear, and
 * a silently missing question is not something anybody debugs.
 */
function findCycles(edges: ReadonlyMap<string, string>): Set<string> {
  const onCycle = new Set<string>();
  const settled = new Set<string>();

  for (const start of edges.keys()) {
    if (settled.has(start)) continue;

    const path: string[] = [];
    const seen = new Set<string>();
    let node: string | undefined = start;

    while (node !== undefined && !seen.has(node)) {
      seen.add(node);
      path.push(node);
      node = edges.get(node);
    }

    // Stopped because we came back to something already on this path: the
    // cycle is the tail from that point on.
    if (node !== undefined && seen.has(node)) {
      const from = path.indexOf(node);
      if (from !== -1) for (const id of path.slice(from)) onCycle.add(id);
    }

    for (const id of path) settled.add(id);
  }

  return onCycle;
}

/** A safety net. With cycles removed the fixed point provably terminates. */
const MAX_PASSES = 50;

export interface Visibility {
  /** Ids of every element that should be shown. */
  visible: ReadonlySet<string>;
  /** Ids hidden because their condition was not met. */
  hidden: ReadonlySet<string>;
  /**
   * Conditions pointing at an element that does not exist, or that cannot
   * settle. Treated as visible — refusing to render a field because its rule is
   * broken would silently drop a question from the form.
   */
  broken: readonly string[];
}

/**
 * Which elements are visible, given the answers so far.
 *
 * Resolved to a fixed point: hiding one element can hide another that depends
 * on it. An element whose target is hidden is itself hidden — a question
 * conditioned on an answer nobody was asked for has no business appearing.
 */
export function resolveVisibility(
  document: FormDocument,
  answers: Answers,
): Visibility {
  const elements = document.pages.flatMap((page) => page.elements);
  const byId = new Map(elements.map((element) => [element.id, element]));

  const conditioned = elements.filter(
    (element): element is InputElement =>
      isInputElement(element) && element.conditional !== null,
  );

  const hidden = new Set<string>();
  const broken = new Set<string>();

  // Rules whose target does not exist. A builder mistake, not a reason to hide
  // a question — dropping it silently is worse than showing it.
  const edges = new Map<string, string>();
  for (const element of conditioned) {
    const rule = element.conditional;
    if (!rule) continue;

    if (!byId.has(rule.targetId)) {
      broken.add(element.id);
      continue;
    }
    edges.set(element.id, rule.targetId);
  }

  // Circular rules are shown and reported, for the same reason.
  for (const id of findCycles(edges)) {
    broken.add(id);
    edges.delete(id);
  }

  const resolvable = conditioned.filter((element) => edges.has(element.id));

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;

    for (const element of resolvable) {
      const rule = element.conditional;
      if (!rule) continue;

      // An element whose target is itself hidden goes too: a question
      // conditioned on an answer nobody was asked for has no business
      // appearing.
      const shouldHide = hidden.has(rule.targetId)
        ? true
        : !evaluateCondition(rule, answers[rule.targetId]);

      if (shouldHide && !hidden.has(element.id)) {
        hidden.add(element.id);
        changed = true;
      } else if (!shouldHide && hidden.has(element.id)) {
        hidden.delete(element.id);
        changed = true;
      }
    }

    if (!changed) break;
  }

  const visible = new Set(
    elements.map((element) => element.id).filter((id) => !hidden.has(id)),
  );

  return { visible, hidden, broken: [...broken] };
}

/**
 * Drops answers to hidden fields.
 *
 * Applied before validation and before storage. Somebody who answers a
 * question, then changes an earlier answer so that question disappears, has not
 * answered it — submitting the stale value would put data in the record that
 * nobody was asked to confirm.
 */
export function pruneHiddenAnswers(
  document: FormDocument,
  answers: Answers,
): Answers {
  const { hidden } = resolveVisibility(document, answers);
  if (hidden.size === 0) return answers;

  const kept: Answers = {};
  for (const [id, answer] of Object.entries(answers)) {
    if (!hidden.has(id)) kept[id] = answer;
  }

  return kept;
}

/** The input elements somebody is actually being asked to fill in. */
export function visibleInputs(
  document: FormDocument,
  answers: Answers,
): InputElement[] {
  const { visible } = resolveVisibility(document, answers);

  return document.pages
    .flatMap((page) => page.elements)
    .filter(
      (element): element is InputElement =>
        isInputElement(element) && visible.has(element.id),
    );
}

/** Whether a particular element is visible. Convenience for the renderer. */
export function isVisible(
  element: FormElement,
  visibility: Visibility,
): boolean {
  return visibility.visible.has(element.id);
}
