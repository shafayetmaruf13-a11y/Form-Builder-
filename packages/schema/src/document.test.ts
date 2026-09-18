import { describe, expect, it } from "vitest";

import {
  SCHEMA_VERSION,
  allElements,
  danglingConditionalTargets,
  duplicateElementIds,
  emptyDocument,
  formDocumentSchema,
  inputElements,
} from "./document";
import { ELEMENT_TYPES, INPUT_ELEMENT_TYPES } from "./elements";
import { sampleDocument } from "./fixtures";

function baseElement(overrides: Record<string, unknown> = {}) {
  return {
    id: "el_1",
    type: "text",
    content: "hello",
    x: 0,
    y: 0,
    w: 100,
    h: 20,
    ...overrides,
  };
}

function documentWith(elements: unknown[]) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "doc_1",
    title: "Test",
    pages: [{ id: "page_1", elements }],
  };
}

describe("form document", () => {
  it("requires at least one page", () => {
    const result = formDocumentSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      id: "doc_1",
      title: "Test",
      pages: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects a document from a different schema version", () => {
    // Architecture rule 4: an old version must be recognisably old, not
    // silently parsed as current.
    const result = formDocumentSchema.safeParse({
      ...documentWith([]),
      schemaVersion: 2,
    });

    expect(result.success).toBe(false);
  });

  it("survives a JSON round trip unchanged", () => {
    // Documents live in jsonb. Anything that doesn't survive this cannot be
    // stored, and a submission must re-render byte-identically years later.
    const roundTripped = formDocumentSchema.parse(
      JSON.parse(JSON.stringify(sampleDocument)),
    );

    expect(roundTripped).toEqual(sampleDocument);
  });

  it("builds an empty document that parses", () => {
    const doc = emptyDocument("doc_new", "page_new");

    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]?.elements).toEqual([]);
    expect(formDocumentSchema.safeParse(doc).success).toBe(true);
  });
});

describe("the sample fixture", () => {
  it("contains one of every element type", () => {
    // This fixture is what proves the coordinate system in Slice 1 and what
    // later slices render, so a new element type must appear in it.
    const present = new Set(
      allElements(sampleDocument).map((element) => element.type),
    );

    expect([...present].sort()).toEqual([...ELEMENT_TYPES].sort());
  });

  it("separates inputs from decoration", () => {
    const inputs = inputElements(sampleDocument);

    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(INPUT_ELEMENT_TYPES).toContain(input.type);
    }
    expect(inputs.length).toBeLessThan(allElements(sampleDocument).length);
  });

  it("has no duplicate or dangling ids", () => {
    expect(duplicateElementIds(sampleDocument)).toEqual([]);
    expect(danglingConditionalTargets(sampleDocument)).toEqual([]);
  });

  it("keeps every element within the page bounds", () => {
    // Not a schema rule — coordinates are deliberately unclamped — but a
    // fixture that renders half off the page proves nothing.
    for (const element of allElements(sampleDocument)) {
      expect(element.x).toBeGreaterThanOrEqual(0);
      expect(element.y).toBeGreaterThanOrEqual(0);
      expect(element.x + element.w).toBeLessThanOrEqual(794);
      expect(element.y + element.h).toBeLessThanOrEqual(1123);
    }
  });
});

describe("document helpers", () => {
  it("finds duplicate element ids", () => {
    const doc = formDocumentSchema.parse(
      documentWith([
        baseElement({ id: "el_dup" }),
        baseElement({ id: "el_dup" }),
        baseElement({ id: "el_other" }),
      ]),
    );

    expect(duplicateElementIds(doc)).toEqual(["el_dup"]);
  });

  it("finds conditionals pointing at a deleted element", () => {
    const doc = formDocumentSchema.parse(
      documentWith([
        {
          id: "el_input",
          type: "textInput",
          label: "Why?",
          x: 0,
          y: 0,
          w: 100,
          h: 40,
          conditional: {
            targetId: "el_deleted",
            operator: "equals",
            value: "yes",
          },
        },
      ]),
    );

    expect(danglingConditionalTargets(doc)).toEqual([
      { elementId: "el_input", targetId: "el_deleted" },
    ]);
  });

  it("returns elements in page order across pages", () => {
    const doc = formDocumentSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      id: "doc_1",
      title: "Test",
      pages: [
        { id: "page_1", elements: [baseElement({ id: "el_a" })] },
        { id: "page_2", elements: [baseElement({ id: "el_b" })] },
      ],
    });

    expect(allElements(doc).map((element) => element.id)).toEqual([
      "el_a",
      "el_b",
    ]);
  });
});
