import { describe, expect, it } from "vitest";

import { createElement } from "./defaults";
import { SCHEMA_VERSION, formDocumentSchema } from "./document";
import { ELEMENT_TYPES } from "./elements";
import {
  addElement,
  elementLocations,
  findElement,
  pageIdOfElement,
  removeElements,
  restoreElements,
  translateElements,
} from "./operations";

function doc(elementIds: string[] = []) {
  return formDocumentSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: "doc_1",
    title: "Test",
    pages: [
      {
        id: "page_1",
        elements: elementIds.map((id, index) =>
          createElement("text", id, { x: index * 10, y: index * 10 }),
        ),
      },
    ],
  });
}

describe("createElement", () => {
  it("produces a valid element for every type", () => {
    for (const type of ELEMENT_TYPES) {
      const element = createElement(type, `el_${type}`, { x: 10, y: 20 });

      expect(element.type, type).toBe(type);
      expect(element.x).toBe(10);
      expect(element.y).toBe(20);
      expect(element.w).toBeGreaterThan(0);
      expect(element.h).toBeGreaterThan(0);
    }
  });

  it("derives option ids from the element id so they stay unique", () => {
    const a = createElement("radioGroup", "el_a", { x: 0, y: 0 });
    const b = createElement("radioGroup", "el_b", { x: 0, y: 0 });

    const ids = [a, b].flatMap((element) =>
      element.type === "radioGroup"
        ? element.options.map((option) => option.id)
        : [],
    );

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("structural sharing", () => {
  // The builder store subscribes per element and compares by identity, so an
  // operation that rebuilds untouched objects would re-render the whole canvas
  // on every drag frame.

  it("returns the same document when nothing changes", () => {
    const before = doc(["el_a"]);

    expect(translateElements(before, [], 5, 5)).toBe(before);
    expect(translateElements(before, ["el_a"], 0, 0)).toBe(before);
    expect(removeElements(before, [])).toBe(before);
    expect(removeElements(before, ["el_missing"])).toBe(before);
    expect(restoreElements(before, [])).toBe(before);
  });

  it("keeps untouched elements identical when one moves", () => {
    const before = doc(["el_a", "el_b"]);
    const after = translateElements(before, ["el_a"], 5, 7);

    const beforeB = findElement(before, "el_b");
    const afterB = findElement(after, "el_b");

    expect(afterB).toBe(beforeB);
    expect(findElement(after, "el_a")).not.toBe(findElement(before, "el_a"));
  });

  it("keeps untouched pages identical", () => {
    const before = formDocumentSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      id: "doc_1",
      title: "Test",
      pages: [
        {
          id: "page_1",
          elements: [createElement("text", "el_a", { x: 0, y: 0 })],
        },
        {
          id: "page_2",
          elements: [createElement("text", "el_b", { x: 0, y: 0 })],
        },
      ],
    });

    const after = translateElements(before, ["el_a"], 1, 1);

    expect(after.pages[1]).toBe(before.pages[1]);
    expect(after.pages[0]).not.toBe(before.pages[0]);
  });

  it("never mutates its input", () => {
    const before = doc(["el_a"]);
    const snapshot = JSON.parse(JSON.stringify(before));

    translateElements(before, ["el_a"], 10, 10);
    removeElements(before, ["el_a"]);
    addElement(
      before,
      "page_1",
      createElement("text", "el_new", { x: 0, y: 0 }),
    );

    expect(before).toEqual(snapshot);
  });
});

describe("add and remove", () => {
  it("appends to the page", () => {
    const before = doc(["el_a"]);
    const after = addElement(
      before,
      "page_1",
      createElement("text", "el_b", { x: 0, y: 0 }),
    );

    expect(after.pages[0]?.elements.map((e) => e.id)).toEqual(["el_a", "el_b"]);
  });

  it("ignores an unknown page", () => {
    const before = doc(["el_a"]);
    const after = addElement(
      before,
      "page_missing",
      createElement("text", "el_b", { x: 0, y: 0 }),
    );

    expect(after).toBe(before);
  });

  it("removes several at once", () => {
    const before = doc(["el_a", "el_b", "el_c"]);
    const after = removeElements(before, ["el_a", "el_c"]);

    expect(after.pages[0]?.elements.map((e) => e.id)).toEqual(["el_b"]);
  });
});

describe("delete and restore round trip", () => {
  // This pair is what makes deletion undoable, so it has to put elements back
  // in their exact original positions, not merely back somewhere.

  it("restores a middle element to its original index", () => {
    const before = doc(["el_a", "el_b", "el_c"]);
    const locations = elementLocations(before, ["el_b"]);
    const deleted = removeElements(before, ["el_b"]);
    const restored = restoreElements(deleted, locations);

    expect(restored.pages[0]?.elements.map((e) => e.id)).toEqual([
      "el_a",
      "el_b",
      "el_c",
    ]);
    expect(restored).toEqual(before);
  });

  it("restores several elements to their original indices", () => {
    const before = doc(["el_a", "el_b", "el_c", "el_d"]);
    const locations = elementLocations(before, ["el_a", "el_c"]);
    const restored = restoreElements(
      removeElements(before, ["el_a", "el_c"]),
      locations,
    );

    expect(restored.pages[0]?.elements.map((e) => e.id)).toEqual([
      "el_a",
      "el_b",
      "el_c",
      "el_d",
    ]);
  });

  it("restores across pages", () => {
    const before = formDocumentSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      id: "doc_1",
      title: "Test",
      pages: [
        {
          id: "page_1",
          elements: [createElement("text", "el_a", { x: 0, y: 0 })],
        },
        {
          id: "page_2",
          elements: [createElement("text", "el_b", { x: 0, y: 0 })],
        },
      ],
    });

    const locations = elementLocations(before, ["el_a", "el_b"]);
    const restored = restoreElements(
      removeElements(before, ["el_a", "el_b"]),
      locations,
    );

    expect(restored).toEqual(before);
  });
});

describe("translate", () => {
  it("moves only the named elements", () => {
    const before = doc(["el_a", "el_b"]);
    const after = translateElements(before, ["el_a"], 5, -3);

    expect(findElement(after, "el_a")).toMatchObject({ x: 5, y: -3 });
    expect(findElement(after, "el_b")).toMatchObject({ x: 10, y: 10 });
  });

  it("allows an element to be moved off the page", () => {
    const before = doc(["el_a"]);
    const after = translateElements(before, ["el_a"], -500, -500);

    expect(findElement(after, "el_a")).toMatchObject({ x: -500, y: -500 });
  });

  it("composes: two moves equal their sum", () => {
    // The command stack merges consecutive nudges by summing deltas, which is
    // only sound if translation composes.
    const before = doc(["el_a"]);
    const twice = translateElements(
      translateElements(before, ["el_a"], 3, 4),
      ["el_a"],
      2,
      1,
    );
    const once = translateElements(before, ["el_a"], 5, 5);

    expect(twice).toEqual(once);
  });
});

describe("lookups", () => {
  it("finds an element and its page", () => {
    const before = doc(["el_a"]);

    expect(findElement(before, "el_a")?.id).toBe("el_a");
    expect(findElement(before, "nope")).toBeUndefined();
    expect(pageIdOfElement(before, "el_a")).toBe("page_1");
    expect(pageIdOfElement(before, "nope")).toBeUndefined();
  });
});
