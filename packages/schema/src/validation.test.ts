import { describe, expect, it } from "vitest";

import type { Answers } from "./answers";
import { createElement } from "./defaults";
import { SCHEMA_VERSION, formDocumentSchema } from "./document";
import {
  type InputElement,
  type InputElementType,
  elementSchema,
} from "./elements";
import {
  MAX_SIGNATURE_CHARS,
  validateAnswers,
  validateField,
} from "./validation";

/** One input element, parsed so every default is applied. */
function field(
  type: InputElementType,
  overrides: Record<string, unknown> = {},
): InputElement {
  return elementSchema.parse({
    ...createElement(type, "el_1", { x: 0, y: 0 }),
    ...overrides,
  }) as InputElement;
}

const OPTIONS = [
  { id: "o1", label: "Talks", value: "talks" },
  { id: "o2", label: "Workshops", value: "workshops" },
];

describe("required", () => {
  it("rejects an empty answer and accepts a given one", () => {
    const element = field("textInput", { required: true });

    expect(validateField(element, undefined)).toBe("This is required");
    expect(validateField(element, "")).toBe("This is required");
    expect(validateField(element, "   ")).toBe("This is required");
    expect(validateField(element, "Ada")).toBeNull();
  });

  it("requires a checkbox to actually be ticked", () => {
    // A required checkbox is a consent box. `false` is an answer, and not an
    // acceptable one.
    const element = field("checkbox", { required: true });

    expect(validateField(element, false)).toBe("This must be ticked");
    expect(validateField(element, true)).toBeNull();
  });

  it("accepts zero and false as answers to optional fields", () => {
    expect(validateField(field("number"), 0)).toBeNull();
    expect(validateField(field("checkbox"), false)).toBeNull();
  });

  it("requires zero to count as answering a required number", () => {
    expect(validateField(field("number", { required: true }), 0)).toBeNull();
  });

  it("leaves an optional blank field alone", () => {
    // The bug this prevents: "" being reported as "too short".
    const element = field("textInput", { validation: { minLength: 5 } });

    expect(validateField(element, "")).toBeNull();
    expect(validateField(element, undefined)).toBeNull();
  });
});

describe("text rules", () => {
  it("applies minLength and maxLength", () => {
    const element = field("textInput", {
      validation: { minLength: 3, maxLength: 5 },
    });

    expect(validateField(element, "ab")).toMatch(/at least 3/);
    expect(validateField(element, "abcdef")).toMatch(/at most 5/);
    expect(validateField(element, "abcd")).toBeNull();
  });

  it("anchors a pattern, so a partial match is not enough", () => {
    const element = field("textInput", {
      validation: { pattern: "[A-Z]{2}\\d+" },
    });

    expect(validateField(element, "AB123")).toBeNull();
    // Unanchored, this would match inside the string and wrongly pass.
    expect(validateField(element, "xxAB123xx")).not.toBeNull();
  });

  it("does not throw on a pattern that is not a valid regex", () => {
    // The pattern comes from a document and runs on the server. A bad one must
    // not take the request down, and it cannot reject every answer forever.
    const element = field("textInput", { validation: { pattern: "([" } });

    expect(() => validateField(element, "anything")).not.toThrow();
    expect(validateField(element, "anything")).toBeNull();
  });

  it("checks an email field's shape", () => {
    const element = field("textInput", { inputType: "email" });

    expect(validateField(element, "ada@example.com")).toBeNull();
    expect(validateField(element, "ada@")).toMatch(/email/);
    expect(validateField(element, "not an email")).toMatch(/email/);
  });

  it("checks a url field's shape", () => {
    const element = field("textInput", { inputType: "url" });

    expect(validateField(element, "https://example.com")).toBeNull();
    expect(validateField(element, "example.com")).toMatch(/web address/);
  });
});

describe("number rules", () => {
  it("applies min and max", () => {
    const element = field("number", { validation: { min: 1, max: 10 } });

    expect(validateField(element, 0)).toMatch(/at least 1/);
    expect(validateField(element, 11)).toMatch(/at most 10/);
    expect(validateField(element, 5)).toBeNull();
  });

  it("rejects something that is not a number", () => {
    expect(validateField(field("number"), "banana")).toBe(
      "That is not a number",
    );
  });

  it("accepts a numeric string, because that is what a form posts", () => {
    expect(validateField(field("number"), "42")).toBeNull();
  });
});

describe("date rules", () => {
  it("requires an ISO date", () => {
    expect(validateField(field("date"), "2026-09-21")).toBeNull();
    expect(validateField(field("date"), "21/09/2026")).toMatch(/valid date/);
    expect(validateField(field("date"), "2026-13-45")).toMatch(/valid date/);
  });

  it("applies minDate and maxDate", () => {
    const element = field("date", {
      validation: { minDate: "2026-01-01", maxDate: "2026-12-31" },
    });

    expect(validateField(element, "2025-12-31")).toMatch(/on or after/);
    expect(validateField(element, "2027-01-01")).toMatch(/on or before/);
    expect(validateField(element, "2026-06-15")).toBeNull();
  });
});

describe("choices", () => {
  it("rejects a value that is not one of the options", () => {
    // Rule 5 in practice: the client only ever offers real options, so an
    // answer outside them means the request did not come from the page.
    const element = field("select", { options: OPTIONS });

    expect(validateField(element, "talks")).toBeNull();
    expect(validateField(element, "admin")).toBe(
      "That is not one of the choices",
    );
  });

  it("applies the same rule to a radio group", () => {
    const element = field("radioGroup", { options: OPTIONS });

    expect(validateField(element, "workshops")).toBeNull();
    expect(validateField(element, "other")).toBe(
      "That is not one of the choices",
    );
  });

  it("checks every member of a checkbox group", () => {
    const element = field("checkboxGroup", { options: OPTIONS });

    expect(validateField(element, ["talks", "workshops"])).toBeNull();
    expect(validateField(element, ["talks", "smuggled"])).toBe(
      "That is not one of the choices",
    );
  });

  it("rejects a repeated choice", () => {
    const element = field("checkboxGroup", { options: OPTIONS });

    expect(validateField(element, ["talks", "talks"])).toMatch(/twice/);
  });

  it("applies minSelected and maxSelected", () => {
    const element = field("checkboxGroup", {
      options: OPTIONS,
      validation: { minSelected: 2, maxSelected: 2 },
    });

    expect(validateField(element, ["talks"])).toMatch(/at least 2/);
    expect(validateField(element, ["talks", "workshops"])).toBeNull();
  });
});

describe("uploads", () => {
  const file = (overrides: Record<string, unknown> = {}) => ({
    objectKey: "up_1",
    filename: "cv.pdf",
    contentType: "application/pdf",
    byteSize: 1000,
    ...overrides,
  });

  it("rejects a second file when the field takes one", () => {
    const element = field("fileUpload", { multiple: false });

    expect(validateField(element, [file()])).toBeNull();
    expect(validateField(element, [file(), file()])).toMatch(/one file/);
  });

  it("applies the size cap", () => {
    const element = field("fileUpload", {
      validation: { maxSizeBytes: 500 },
    });

    expect(validateField(element, [file({ byteSize: 900 })])).toMatch(/under/);
  });

  it("accepts a type by MIME or by extension", () => {
    const element = field("fileUpload", {
      validation: { acceptedTypes: ["application/pdf", ".png"] },
    });

    expect(validateField(element, [file()])).toBeNull();
    expect(
      validateField(element, [
        file({ filename: "logo.PNG", contentType: "image/png" }),
      ]),
    ).toBeNull();
    expect(
      validateField(element, [
        file({ filename: "sheet.xlsx", contentType: "application/zip" }),
      ]),
    ).toMatch(/not accepted/);
  });
});

describe("signatures", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";

  it("accepts a PNG data URL", () => {
    expect(validateField(field("signature"), png)).toBeNull();
  });

  it("rejects something that is not one", () => {
    // The field arrives as a string from an untrusted page. Without this it is
    // an unbounded blob upload that happens to land in jsonb.
    expect(validateField(field("signature"), "not a signature")).toMatch(
      /valid signature/,
    );
    expect(
      validateField(field("signature"), "data:text/html;base64,PHNjcmlwdD4="),
    ).toMatch(/valid signature/);
  });

  it("rejects one that is too large", () => {
    const huge = `data:image/png;base64,${"A".repeat(MAX_SIGNATURE_CHARS)}`;
    expect(validateField(field("signature"), huge)).toMatch(/too large/);
  });

  it("still lets an optional one be left blank", () => {
    expect(validateField(field("signature"), "")).toBeNull();
  });
});

describe("validating a whole submission", () => {
  function doc(
    specs: { id: string; type: InputElementType; extra?: object }[],
  ) {
    return formDocumentSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      id: "doc_1",
      title: "Test",
      pages: [
        {
          id: "page_1",
          elements: specs.map((spec, index) => ({
            ...createElement(spec.type, spec.id, { x: 0, y: index * 80 }),
            ...spec.extra,
          })),
        },
      ],
    });
  }

  it("collects one error per bad field", () => {
    const document = doc([
      { id: "el_a", type: "textInput", extra: { required: true } },
      { id: "el_b", type: "number", extra: { validation: { min: 10 } } },
      { id: "el_c", type: "textInput" },
    ]);

    const { ok, errors } = validateAnswers(document, { el_b: 3, el_c: "fine" });

    expect(ok).toBe(false);
    expect(errors.map((error) => error.elementId).sort()).toEqual([
      "el_a",
      "el_b",
    ]);
  });

  it("passes a good submission", () => {
    const document = doc([
      { id: "el_a", type: "textInput", extra: { required: true } },
    ]);

    expect(validateAnswers(document, { el_a: "Ada" }).ok).toBe(true);
  });

  it("does not require a hidden field, and drops its answer", () => {
    // The reason validation runs through the evaluator. A required question
    // that a condition has hidden was never asked, and blocking on it would
    // make the form unsubmittable.
    const document = doc([
      { id: "el_target", type: "select", extra: { options: OPTIONS } },
      {
        id: "el_dependent",
        type: "textInput",
        extra: {
          required: true,
          conditional: {
            targetId: "el_target",
            operator: "equals",
            value: "workshops",
          },
        },
      },
    ]);

    const submitted: Answers = { el_target: "talks", el_dependent: "stale" };
    const result = validateAnswers(document, submitted);

    expect(result.ok).toBe(true);
    expect(result.answers).toEqual({ el_target: "talks" });
  });

  it("does require a field a condition has revealed", () => {
    const document = doc([
      { id: "el_target", type: "select", extra: { options: OPTIONS } },
      {
        id: "el_dependent",
        type: "textInput",
        extra: {
          required: true,
          conditional: {
            targetId: "el_target",
            operator: "equals",
            value: "workshops",
          },
        },
      },
    ]);

    const result = validateAnswers(document, { el_target: "workshops" });

    expect(result.ok).toBe(false);
    expect(result.errors[0]?.elementId).toBe("el_dependent");
  });

  it("ignores static elements", () => {
    const document = formDocumentSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      id: "doc_1",
      title: "Test",
      pages: [
        {
          id: "page_1",
          elements: [createElement("text", "el_text", { x: 0, y: 0 })],
        },
      ],
    });

    expect(validateAnswers(document, {}).ok).toBe(true);
  });

  it("ignores an answer to an element that is not in the document", () => {
    // A submission carrying extra keys — from a tampered request or a stale
    // tab — must not smuggle them into storage.
    const document = doc([{ id: "el_a", type: "textInput" }]);

    const result = validateAnswers(document, {
      el_a: "real",
      el_ghost: "not in this form",
    });

    expect(result.ok).toBe(true);
    expect(result.answers.el_ghost).toBeUndefined();
  });
});
