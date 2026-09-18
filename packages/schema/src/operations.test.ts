import { describe, expect, it } from "vitest";

import { createElement, createPage } from "./defaults";
import { SCHEMA_VERSION, formDocumentSchema } from "./document";
import { ELEMENT_TYPES } from "./elements";
import {
  addElement,
  addPage,
  duplicateElements,
  elementLocations,
  findElement,
  insertElements,
  pageIdOfElement,
  removeElements,
  reorderZ,
  restoreElements,
  movePage,
  removePage,
  setElementGeometry,
  setTitle,
  translateElements,
  updateElement,
  updateElementStyle,
  updatePage,
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

describe("z-order", () => {
  /** Ids in paint order, bottom first. */
  function order(document: ReturnType<typeof doc>) {
    const page = document.pages[0]!;
    return [...page.elements]
      .sort((a, b) => a.z - b.z)
      .map((element) => element.id);
  }

  function stacked(ids: string[]) {
    return formDocumentSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      id: "doc_1",
      title: "Test",
      pages: [
        {
          id: "page_1",
          elements: ids.map((id, index) =>
            createElement("text", id, { x: 0, y: 0, z: index }),
          ),
        },
      ],
    });
  }

  it("brings to front and sends to back", () => {
    const before = stacked(["a", "b", "c"]);

    expect(order(reorderZ(before, ["a"], "front"))).toEqual(["b", "c", "a"]);
    expect(order(reorderZ(before, ["c"], "back"))).toEqual(["c", "a", "b"]);
  });

  it("steps one place forward and backward", () => {
    const before = stacked(["a", "b", "c"]);

    expect(order(reorderZ(before, ["a"], "forward"))).toEqual(["b", "a", "c"]);
    expect(order(reorderZ(before, ["c"], "backward"))).toEqual(["a", "c", "b"]);
  });

  it("does nothing at the ends", () => {
    const before = stacked(["a", "b", "c"]);

    expect(reorderZ(before, ["c"], "forward")).toBe(before);
    expect(reorderZ(before, ["a"], "backward")).toBe(before);
  });

  it("moves a contiguous block as one, keeping its internal order", () => {
    const before = stacked(["a", "b", "c", "d"]);

    expect(order(reorderZ(before, ["a", "b"], "forward"))).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
  });

  it("keeps the selection's relative order when brought to front", () => {
    const before = stacked(["a", "b", "c", "d"]);

    expect(order(reorderZ(before, ["a", "c"], "front"))).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
  });

  it("normalises z to a dense sequence", () => {
    // Sparse or duplicate z values make paint order fall back to document
    // order for ties, so what you see stops matching what is stored.
    const before = formDocumentSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      id: "doc_1",
      title: "Test",
      pages: [
        {
          id: "page_1",
          elements: [
            createElement("text", "a", { x: 0, y: 0, z: 40 }),
            createElement("text", "b", { x: 0, y: 0, z: 40 }),
            createElement("text", "c", { x: 0, y: 0, z: 99 }),
          ],
        },
      ],
    });

    const after = reorderZ(before, ["c"], "back");

    expect(after.pages[0]?.elements.map((e) => e.z).sort()).toEqual([0, 1, 2]);
  });

  it("ignores an empty selection", () => {
    const before = stacked(["a"]);
    expect(reorderZ(before, [], "front")).toBe(before);
  });
});

describe("duplicate and insert", () => {
  it("gives copies fresh ids and an offset", () => {
    // Architecture rule 3: ids are identity. A duplicate that kept them would
    // make two elements share their answers.
    const before = doc(["el_a"]);
    const copies = duplicateElements(before, ["el_a"], ["el_new"], {
      dx: 10,
      dy: 10,
    });

    expect(copies).toHaveLength(1);
    expect(copies[0]?.id).toBe("el_new");
    expect(copies[0]).toMatchObject({ x: 10, y: 10 });
  });

  it("copies in document order, not the order ids were given", () => {
    const before = doc(["el_a", "el_b"]);
    const copies = duplicateElements(before, ["el_b", "el_a"], ["one", "two"], {
      dx: 0,
      dy: 0,
    });

    expect(copies.map((element) => element.id)).toEqual(["one", "two"]);
    // el_a is first in the document, so it gets the first new id.
    expect(copies[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("appends inserted elements to the page", () => {
    const before = doc(["el_a"]);
    const copies = duplicateElements(before, ["el_a"], ["el_copy"], {
      dx: 5,
      dy: 5,
    });
    const after = insertElements(before, "page_1", copies);

    expect(after.pages[0]?.elements.map((e) => e.id)).toEqual([
      "el_a",
      "el_copy",
    ]);
  });

  it("ignores an empty insert", () => {
    const before = doc(["el_a"]);
    expect(insertElements(before, "page_1", [])).toBe(before);
  });
});

describe("geometry", () => {
  it("sets position, size and rotation together", () => {
    const before = doc(["el_a"]);
    const after = setElementGeometry(before, "el_a", {
      x: 5,
      y: 6,
      w: 70,
      h: 80,
      rotation: 45,
    });

    expect(findElement(after, "el_a")).toMatchObject({
      x: 5,
      y: 6,
      w: 70,
      h: 80,
      rotation: 45,
    });
  });

  it("returns the same document when the geometry is unchanged", () => {
    const before = doc(["el_a"]);
    const element = findElement(before, "el_a")!;

    expect(
      setElementGeometry(before, "el_a", {
        x: element.x,
        y: element.y,
        w: element.w,
        h: element.h,
        rotation: element.rotation,
      }),
    ).toBe(before);
  });
});

describe("updating an element", () => {
  it("applies a patch", () => {
    const before = doc(["el_a"]);
    const after = updateElement(before, "el_a", { content: "Hello" });

    expect(findElement(after, "el_a")).toMatchObject({ content: "Hello" });
  });

  it("refuses a patch that would make the element invalid", () => {
    // The panel is a wall of free-text and numeric inputs; a bad value must
    // leave the document alone rather than corrupt it.
    const before = doc(["el_a"]);

    expect(updateElement(before, "el_a", { w: -50 })).toBe(before);
    expect(updateElement(before, "el_a", { type: "carousel" })).toBe(before);
    expect(updateElement(before, "el_a", { style: { opacity: 5 } })).toBe(
      before,
    );
  });

  it("ignores an unknown element", () => {
    const before = doc(["el_a"]);
    expect(updateElement(before, "nope", { content: "x" })).toBe(before);
  });

  it("merges a style patch without dropping the rest of the block", () => {
    const before = doc(["el_a"]);
    const after = updateElementStyle(before, "el_a", { fontSize: 24 });
    const style = findElement(after, "el_a")!.style;

    expect(style.fontSize).toBe(24);
    expect(style.fontFamily).toBe("inter");
    expect(style.opacity).toBe(1);
  });

  it("leaves other elements identical", () => {
    const before = doc(["el_a", "el_b"]);
    const after = updateElement(before, "el_a", { content: "changed" });

    expect(findElement(after, "el_b")).toBe(findElement(before, "el_b"));
  });
});

describe("pages", () => {
  function pages(document: ReturnType<typeof doc>) {
    return document.pages.map((page) => page.id);
  }

  function twoPages() {
    return formDocumentSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      id: "doc_1",
      title: "Test",
      pages: [
        { id: "page_1", elements: [] },
        { id: "page_2", elements: [] },
      ],
    });
  }

  it("appends a page by default and inserts at an index when given one", () => {
    const before = twoPages();

    expect(pages(addPage(before, createPage("page_3")))).toEqual([
      "page_1",
      "page_2",
      "page_3",
    ]);
    expect(pages(addPage(before, createPage("page_3"), 1))).toEqual([
      "page_1",
      "page_3",
      "page_2",
    ]);
  });

  it("removes a page", () => {
    expect(pages(removePage(twoPages(), "page_1"))).toEqual(["page_2"]);
  });

  it("refuses to remove the last page", () => {
    // formDocumentSchema requires at least one, and a document with nothing to
    // render is never what someone meant.
    const single = doc([]);
    expect(removePage(single, "page_1")).toBe(single);
  });

  it("reorders pages", () => {
    const before = formDocumentSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      id: "doc_1",
      title: "Test",
      pages: [
        { id: "a", elements: [] },
        { id: "b", elements: [] },
        { id: "c", elements: [] },
      ],
    });

    expect(pages(movePage(before, "a", 2))).toEqual(["b", "c", "a"]);
    expect(pages(movePage(before, "c", 0))).toEqual(["c", "a", "b"]);
    expect(movePage(before, "a", 0)).toBe(before);
    expect(movePage(before, "missing", 0)).toBe(before);
  });

  it("clamps an out-of-range move", () => {
    const before = twoPages();
    expect(pages(movePage(before, "page_1", 99))).toEqual(["page_2", "page_1"]);
  });

  it("patches a page's background and leaves other pages identical", () => {
    const before = twoPages();
    const after = updatePage(before, "page_2", { background: "#f0f0f0" });

    expect(after.pages[1]?.background).toBe("#f0f0f0");
    expect(after.pages[0]).toBe(before.pages[0]);
  });

  it("sets the document title", () => {
    const before = doc([]);
    expect(setTitle(before, "Renamed").title).toBe("Renamed");
    expect(setTitle(before, before.title)).toBe(before);
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
