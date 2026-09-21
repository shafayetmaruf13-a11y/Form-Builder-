import {
  SCHEMA_VERSION,
  createElement,
  formDocumentSchema,
} from "@formcraft/schema";
import { describe, expect, it } from "vitest";

import { publishProblems } from "./checks";

function doc(elements: object[]) {
  return formDocumentSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: "doc_1",
    title: "Test",
    pages: [{ id: "page_1", elements }],
  });
}

const OPTIONS = [{ id: "o1", label: "Yes", value: "yes" }];

/** A valid, publishable field. */
function goodField(id = "el_1") {
  return { ...createElement("textInput", id, { x: 0, y: 0 }), label: "Name" };
}

describe("publishProblems", () => {
  it("passes a form with one labelled field", () => {
    expect(publishProblems(doc([goodField()]))).toEqual([]);
  });

  it("refuses a form with nothing to fill in", () => {
    // A form of pure decoration collects nothing, so publishing it is always a
    // mistake rather than a choice.
    const document = doc([createElement("text", "el_text", { x: 0, y: 0 })]);

    expect(publishProblems(document)[0]?.message).toMatch(/no fields/);
  });

  it("refuses an unlabelled field, and names it", () => {
    // WCAG 2.2 AA, and unfixable once the version is immutable and the link is
    // circulating.
    const document = doc([
      goodField("el_1"),
      { ...createElement("textInput", "el_2", { x: 0, y: 100 }), label: "  " },
    ]);

    const problem = publishProblems(document).find((p) =>
      p.message.includes("label"),
    );

    expect(problem?.elementIds).toEqual(["el_2"]);
  });

  it("refuses a dangling conditional target", () => {
    const document = doc([
      {
        ...goodField("el_1"),
        conditional: {
          targetId: "el_deleted",
          operator: "equals",
          value: "x",
        },
      },
    ]);

    const problem = publishProblems(document).find((p) =>
      p.message.includes("conditional"),
    );

    expect(problem?.elementIds).toEqual(["el_1"]);
  });

  it("refuses a choice field with no options", () => {
    const document = doc([
      goodField("el_1"),
      {
        ...createElement("select", "el_2", { x: 0, y: 100 }),
        label: "Pick one",
        options: [],
      },
    ]);

    const problem = publishProblems(document).find((p) =>
      p.message.includes("options"),
    );

    expect(problem?.elementIds).toEqual(["el_2"]);
  });

  it("accepts a choice field that has options", () => {
    const document = doc([
      {
        ...createElement("select", "el_2", { x: 0, y: 0 }),
        label: "Pick one",
        options: OPTIONS,
      },
    ]);

    expect(publishProblems(document)).toEqual([]);
  });

  it("refuses duplicate element ids", () => {
    // Answers are keyed by element id, so two fields sharing one would
    // overwrite each other in every submission ever made.
    const document = doc([goodField("el_same"), goodField("el_same")]);

    const problem = publishProblems(document).find((p) =>
      p.message.includes("share an id"),
    );

    expect(problem?.elementIds).toEqual(["el_same"]);
  });

  it("reports every problem at once, not just the first", () => {
    // Publishing is a moment of intent. Making somebody fix one thing, click
    // again, and find another is a bad way to spend their afternoon.
    const document = doc([
      { ...createElement("textInput", "el_1", { x: 0, y: 0 }), label: "" },
      {
        ...createElement("select", "el_2", { x: 0, y: 100 }),
        label: "",
        options: [],
      },
    ]);

    expect(publishProblems(document).length).toBeGreaterThan(1);
  });
});
