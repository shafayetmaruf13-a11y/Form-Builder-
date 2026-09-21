import { describe, expect, it } from "vitest";

import type { Answers } from "./answers";
import {
  evaluateCondition,
  pruneHiddenAnswers,
  resolveVisibility,
  visibleInputs,
} from "./conditions";
import { createElement } from "./defaults";
import { SCHEMA_VERSION, formDocumentSchema } from "./document";
import type { ConditionOperator } from "./elements";

function condition(
  operator: ConditionOperator,
  value: string | number | boolean | null = null,
) {
  return { targetId: "el_target", operator, value };
}

/** A document of input elements, optionally with conditions. */
function doc(
  specs: {
    id: string;
    type?: "textInput" | "checkbox" | "number" | "checkboxGroup" | "select";
    conditional?: {
      targetId: string;
      operator: ConditionOperator;
      value?: string | number | boolean | null;
    } | null;
    required?: boolean;
  }[],
) {
  return formDocumentSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: "doc_1",
    title: "Test",
    pages: [
      {
        id: "page_1",
        elements: specs.map((spec, index) => ({
          ...createElement(spec.type ?? "textInput", spec.id, {
            x: 0,
            y: index * 80,
          }),
          ...(spec.conditional !== undefined
            ? {
                conditional: spec.conditional
                  ? { value: null, ...spec.conditional }
                  : null,
              }
            : {}),
          ...(spec.required !== undefined ? { required: spec.required } : {}),
        })),
      },
    ],
  });
}

describe("equals and notEquals", () => {
  it("compares as text, so a select value and a number both work", () => {
    expect(evaluateCondition(condition("equals", "other"), "other")).toBe(true);
    expect(evaluateCondition(condition("equals", "other"), "gb")).toBe(false);
    expect(evaluateCondition(condition("equals", 42), 42)).toBe(true);
    expect(evaluateCondition(condition("equals", "42"), 42)).toBe(true);
    expect(evaluateCondition(condition("equals", true), true)).toBe(true);
  });

  it("inverts for notEquals", () => {
    expect(evaluateCondition(condition("notEquals", "gb"), "other")).toBe(true);
    expect(evaluateCondition(condition("notEquals", "gb"), "gb")).toBe(false);
  });

  it("treats an unanswered field as empty text", () => {
    expect(evaluateCondition(condition("equals", ""), undefined)).toBe(true);
    expect(evaluateCondition(condition("notEquals", "gb"), undefined)).toBe(
      true,
    );
  });
});

describe("isEmpty and isNotEmpty", () => {
  it("agree with what counts as answered", () => {
    for (const empty of [undefined, null, "", "   ", []]) {
      expect(evaluateCondition(condition("isEmpty"), empty as never)).toBe(
        true,
      );
      expect(evaluateCondition(condition("isNotEmpty"), empty as never)).toBe(
        false,
      );
    }
  });

  it("treat false as answered, because it is an answer", () => {
    // "No" is a reply. A condition asking whether somebody answered should say
    // yes — required-ness is a different question, handled elsewhere.
    expect(evaluateCondition(condition("isEmpty"), false)).toBe(false);
    expect(evaluateCondition(condition("isNotEmpty"), false)).toBe(true);
  });

  it("treat zero as answered", () => {
    expect(evaluateCondition(condition("isNotEmpty"), 0)).toBe(true);
  });
});

describe("contains", () => {
  it("matches a substring of text, case-insensitively", () => {
    expect(evaluateCondition(condition("contains", "war"), "Warsaw")).toBe(
      true,
    );
    expect(evaluateCondition(condition("contains", "xyz"), "Warsaw")).toBe(
      false,
    );
  });

  it("matches an exact option of a multi-select", () => {
    // Not a substring here: an option "work" must not match "workshops".
    expect(
      evaluateCondition(condition("contains", "talks"), ["talks", "workshops"]),
    ).toBe(true);
    expect(
      evaluateCondition(condition("contains", "work"), ["workshops"]),
    ).toBe(false);
  });

  it("inverts for notContains", () => {
    expect(evaluateCondition(condition("notContains", "xyz"), "Warsaw")).toBe(
      true,
    );
    expect(
      evaluateCondition(condition("notContains", "talks"), ["talks"]),
    ).toBe(false);
  });
});

describe("greaterThan and lessThan", () => {
  it("compare numerically, not as text", () => {
    // The bug this prevents: as strings, "9" > "10".
    expect(evaluateCondition(condition("greaterThan", 9), 10)).toBe(true);
    expect(evaluateCondition(condition("lessThan", 9), 10)).toBe(false);
    expect(evaluateCondition(condition("greaterThan", "9"), "10")).toBe(true);
  });

  it("are false when either side is not a number", () => {
    // Rather than coercing "banana" to something and comparing it.
    expect(evaluateCondition(condition("greaterThan", 5), "banana")).toBe(
      false,
    );
    expect(evaluateCondition(condition("lessThan", "banana"), 5)).toBe(false);
    expect(evaluateCondition(condition("greaterThan", 5), undefined)).toBe(
      false,
    );
    expect(evaluateCondition(condition("greaterThan", 5), "")).toBe(false);
  });

  it("handle zero and negatives", () => {
    expect(evaluateCondition(condition("greaterThan", -5), 0)).toBe(true);
    expect(evaluateCondition(condition("lessThan", 0), -1)).toBe(true);
  });
});

describe("resolving visibility", () => {
  it("shows an unconditional element always", () => {
    const document = doc([{ id: "el_a" }]);
    const { visible, hidden } = resolveVisibility(document, {});

    expect(visible.has("el_a")).toBe(true);
    expect(hidden.size).toBe(0);
  });

  it("hides an element whose condition is not met, and shows it when it is", () => {
    const document = doc([
      { id: "el_target", type: "select" },
      {
        id: "el_dependent",
        conditional: {
          targetId: "el_target",
          operator: "equals",
          value: "other",
        },
      },
    ]);

    expect(resolveVisibility(document, {}).hidden.has("el_dependent")).toBe(
      true,
    );
    expect(
      resolveVisibility(document, { el_target: "other" }).visible.has(
        "el_dependent",
      ),
    ).toBe(true);
  });

  it("hides a chain: hiding A hides B that depends on A", () => {
    // The reason this is a fixed point rather than a single pass. Asking
    // somebody a question conditioned on an answer they were never asked for
    // makes no sense.
    const document = doc([
      { id: "el_target", type: "select" },
      {
        id: "el_b",
        conditional: {
          targetId: "el_target",
          operator: "equals",
          value: "yes",
        },
      },
      {
        id: "el_c",
        conditional: { targetId: "el_b", operator: "isNotEmpty" },
      },
    ]);

    const { hidden } = resolveVisibility(document, {
      el_target: "no",
      el_b: "something",
    });

    expect(hidden.has("el_b")).toBe(true);
    expect(hidden.has("el_c")).toBe(true);
  });

  it("reveals a chain when the root condition is met", () => {
    const document = doc([
      { id: "el_target", type: "select" },
      {
        id: "el_b",
        conditional: {
          targetId: "el_target",
          operator: "equals",
          value: "yes",
        },
      },
      {
        id: "el_c",
        conditional: { targetId: "el_b", operator: "isNotEmpty" },
      },
    ]);

    const { visible } = resolveVisibility(document, {
      el_target: "yes",
      el_b: "filled",
    });

    expect(visible.has("el_b")).toBe(true);
    expect(visible.has("el_c")).toBe(true);
  });

  it("shows an element whose target no longer exists, and reports it", () => {
    // A dangling reference is a builder mistake. Dropping the question
    // silently would be worse than showing it.
    const document = doc([
      {
        id: "el_orphan",
        conditional: { targetId: "el_deleted", operator: "equals", value: "x" },
      },
    ]);

    const { visible, broken } = resolveVisibility(document, {});

    expect(visible.has("el_orphan")).toBe(true);
    expect(broken).toContain("el_orphan");
  });

  it("does not hang on a cycle, and shows everything instead", () => {
    const document = doc([
      { id: "el_a", conditional: { targetId: "el_b", operator: "isNotEmpty" } },
      { id: "el_b", conditional: { targetId: "el_a", operator: "isNotEmpty" } },
    ]);

    const { visible, broken } = resolveVisibility(document, {});

    expect(visible.has("el_a")).toBe(true);
    expect(visible.has("el_b")).toBe(true);
    expect(broken.length).toBeGreaterThan(0);
  });
});

describe("pruning hidden answers", () => {
  it("drops an answer to a field that is no longer shown", () => {
    // Somebody answers, then changes an earlier answer so the question
    // disappears. They have not answered it, and the stale value must not be
    // submitted behind their back.
    const document = doc([
      { id: "el_target", type: "select" },
      {
        id: "el_dependent",
        conditional: {
          targetId: "el_target",
          operator: "equals",
          value: "yes",
        },
      },
    ]);

    const answers: Answers = { el_target: "no", el_dependent: "typed earlier" };
    const pruned = pruneHiddenAnswers(document, answers);

    expect(pruned).toEqual({ el_target: "no" });
  });

  it("keeps everything when nothing is hidden", () => {
    const document = doc([{ id: "el_a" }]);
    const answers: Answers = { el_a: "kept" };

    // Same object back, since nothing changed.
    expect(pruneHiddenAnswers(document, answers)).toBe(answers);
  });

  it("drops a whole hidden chain", () => {
    const document = doc([
      { id: "el_target", type: "select" },
      {
        id: "el_b",
        conditional: {
          targetId: "el_target",
          operator: "equals",
          value: "yes",
        },
      },
      { id: "el_c", conditional: { targetId: "el_b", operator: "isNotEmpty" } },
    ]);

    const pruned = pruneHiddenAnswers(document, {
      el_target: "no",
      el_b: "stale",
      el_c: "also stale",
    });

    expect(pruned).toEqual({ el_target: "no" });
  });
});

describe("visibleInputs", () => {
  it("lists only what somebody is actually being asked", () => {
    const document = doc([
      { id: "el_target", type: "select" },
      {
        id: "el_hidden",
        conditional: {
          targetId: "el_target",
          operator: "equals",
          value: "yes",
        },
      },
    ]);

    expect(visibleInputs(document, {}).map((element) => element.id)).toEqual([
      "el_target",
    ]);
  });
});
