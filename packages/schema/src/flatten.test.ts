import { describe, expect, it } from "vitest";

import type { Answers } from "./answers";
import { createElement } from "./defaults";
import { SCHEMA_VERSION, formDocumentSchema } from "./document";
import type { InputElementType } from "./elements";
import {
  columnsFor,
  flattenSubmission,
  orderedInputs,
  toCell,
} from "./flatten";

const OPTIONS = [
  { id: "o1", label: "Talks and lectures", value: "talks" },
  { id: "o2", label: "Workshops", value: "workshops" },
];

interface Spec {
  id: string;
  type?: InputElementType;
  label?: string;
  x?: number;
  y?: number;
  extra?: object;
}

function doc(specs: Spec[], pages = 1) {
  const build = (list: Spec[], pageId: string) => ({
    id: pageId,
    elements: list.map((spec, index) => ({
      ...createElement(spec.type ?? "textInput", spec.id, {
        x: spec.x ?? 0,
        y: spec.y ?? index * 100,
      }),
      label: spec.label ?? spec.id,
      ...spec.extra,
    })),
  });

  return formDocumentSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: "doc_1",
    title: "Test",
    pages:
      pages === 1
        ? [build(specs, "page_1")]
        : [build(specs.slice(0, 1), "page_1"), build(specs.slice(1), "page_2")],
  });
}

/** One element, parsed, for the cell tests. */
function field(type: InputElementType, extra: object = {}) {
  return doc([{ id: "el_1", type, extra }]).pages[0]!.elements[0] as never;
}

describe("column order", () => {
  it("reads top to bottom, then left to right", () => {
    // Not z (paint order) and not document order (the order things were
    // dragged out). A person reads the page.
    const document = doc([
      { id: "el_c", x: 400, y: 200 },
      { id: "el_a", x: 40, y: 40 },
      { id: "el_b", x: 400, y: 40 },
      { id: "el_d", x: 40, y: 200 },
    ]);

    expect(orderedInputs(document).map((e) => e.id)).toEqual([
      "el_a",
      "el_b",
      "el_d",
      "el_c",
    ]);
  });

  it("treats fields within a line of each other as the same row", () => {
    // Two fields side by side, nudged a few pixels apart, must not swap.
    const document = doc([
      { id: "el_right", x: 400, y: 42 },
      { id: "el_left", x: 40, y: 48 },
    ]);

    expect(orderedInputs(document).map((e) => e.id)).toEqual([
      "el_left",
      "el_right",
    ]);
  });

  it("keeps pages in order", () => {
    const document = doc(
      [
        { id: "el_p1", y: 900 },
        { id: "el_p2", y: 40 },
      ],
      2,
    );

    // Page 1's field comes first even though it sits lower on its own page.
    expect(orderedInputs(document).map((e) => e.id)).toEqual([
      "el_p1",
      "el_p2",
    ]);
  });

  it("ignores static elements", () => {
    const document = doc([
      { id: "el_text", type: "text" as InputElementType },
      { id: "el_input" },
    ]);

    expect(orderedInputs(document).map((e) => e.id)).toEqual(["el_input"]);
  });
});

describe("columns across versions", () => {
  it("uses one version's fields in its own order", () => {
    const v1 = doc([
      { id: "el_name", label: "Full name" },
      { id: "el_email", label: "Email" },
    ]);

    expect(columnsFor([v1]).map((c) => [c.elementId, c.header])).toEqual([
      ["el_name", "Full name"],
      ["el_email", "Email"],
    ]);
  });

  it("keeps a renamed field as one column, under its newest label", () => {
    // Keyed by element id (rule 3). A rename must not split a column in two
    // and leave half the answers in each.
    const v2 = doc([{ id: "el_name", label: "Full legal name" }]);
    const v1 = doc([{ id: "el_name", label: "Name" }]);

    const columns = columnsFor([v2, v1]);

    expect(columns).toHaveLength(1);
    expect(columns[0]?.header).toBe("Full legal name");
    expect(columns[0]?.retired).toBe(false);
  });

  it("keeps a field that a later version removed, and marks it retired", () => {
    // Otherwise the answers people gave to it silently vanish from the export,
    // which for a record of submissions is data loss.
    const v2 = doc([{ id: "el_name", label: "Name" }]);
    const v1 = doc([
      { id: "el_name", label: "Name" },
      { id: "el_fax", label: "Fax number" },
    ]);

    const columns = columnsFor([v2, v1]);

    expect(columns.map((c) => c.elementId)).toEqual(["el_name", "el_fax"]);
    expect(columns.find((c) => c.elementId === "el_fax")?.retired).toBe(true);
    expect(columns.find((c) => c.elementId === "el_name")?.retired).toBe(false);
  });

  it("puts the newest version's fields first", () => {
    const v2 = doc([
      { id: "el_new", label: "Added in v2" },
      { id: "el_name", label: "Name" },
    ]);
    const v1 = doc([{ id: "el_name", label: "Name" }, { id: "el_old" }]);

    expect(columnsFor([v2, v1]).map((c) => c.elementId)).toEqual([
      "el_new",
      "el_name",
      "el_old",
    ]);
  });

  it("falls back to the element id when a label is blank", () => {
    // A header of "" would give an unusable sheet.
    const document = doc([{ id: "el_unnamed", label: "   " }]);
    expect(columnsFor([document])[0]?.header).toBe("el_unnamed");
  });

  it("handles no versions at all", () => {
    expect(columnsFor([])).toEqual([]);
  });
});

describe("cell values", () => {
  it("writes a number as a number", () => {
    // A column of text numbers sorts alphabetically and =SUM() over it is 0.
    expect(toCell(field("number"), 42)).toBe(42);
    expect(toCell(field("number"), "42")).toBe(42);
    expect(toCell(field("number"), 0)).toBe(0);
  });

  it("keeps a non-numeric answer to a number field rather than losing it", () => {
    expect(toCell(field("number"), "n/a")).toBe("n/a");
  });

  it("writes a date as a Date, at UTC midnight", () => {
    const cell = toCell(field("date"), "2026-09-30");

    expect(cell).toBeInstanceOf(Date);
    // Local midnight would render as the 29th for anybody west of Greenwich.
    expect((cell as Date).toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });

  it("leaves a malformed date as text", () => {
    expect(toCell(field("date"), "30/09/2026")).toBe("30/09/2026");
  });

  it("writes a checkbox as a boolean", () => {
    expect(toCell(field("checkbox"), true)).toBe(true);
    expect(toCell(field("checkbox"), false)).toBe(false);
  });

  it("writes a choice as its label, not its stored value", () => {
    const element = field("select", { options: OPTIONS });
    expect(toCell(element, "talks")).toBe("Talks and lectures");
  });

  it("falls back to the raw value for a choice that is no longer an option", () => {
    // An older submission can hold a value a later version removed.
    const element = field("select", { options: OPTIONS });
    expect(toCell(element, "removed-option")).toBe("removed-option");
  });

  it("joins a multi-select with labels", () => {
    const element = field("checkboxGroup", { options: OPTIONS });
    expect(toCell(element, ["talks", "workshops"])).toBe(
      "Talks and lectures, Workshops",
    );
  });

  it("writes files as their filenames", () => {
    const element = field("fileUpload");
    const files = [
      {
        objectKey: "k1",
        filename: "cv.pdf",
        contentType: "application/pdf",
        byteSize: 1,
      },
      {
        objectKey: "k2",
        filename: "photo.png",
        contentType: "image/png",
        byteSize: 2,
      },
    ];

    expect(toCell(element, files)).toBe("cv.pdf, photo.png");
  });

  it("never puts a signature's data URL in a cell", () => {
    // 15KB of base64 in a cell is unusable.
    const element = field("signature");
    expect(toCell(element, "data:image/png;base64,iVBORw0KGgo=")).toBe(
      "(signed)",
    );
    expect(toCell(element, "")).toBeNull();
  });

  it("writes an unanswered field as null, not an empty string", () => {
    // A blank cell, so COUNTA and filters treat it as missing.
    for (const type of ["textInput", "number", "date", "select"] as const) {
      expect(toCell(field(type), undefined), type).toBeNull();
      expect(toCell(field(type), null), type).toBeNull();
    }
    expect(toCell(field("checkboxGroup", { options: OPTIONS }), [])).toBeNull();
  });

  it("reports an answer whose element is unknown, as text", () => {
    // A submission filled against a version this sheet does not have the
    // document for. Reporting it plainly beats dropping it.
    expect(toCell(undefined, "something")).toBe("something");
    expect(toCell(undefined, undefined)).toBeNull();
  });
});

describe("flattening a submission", () => {
  it("puts each answer under its own column", () => {
    const document = doc([
      { id: "el_name", label: "Name" },
      { id: "el_age", type: "number", label: "Age" },
    ]);
    const columns = columnsFor([document]);
    const answers: Answers = { el_name: "Ada", el_age: 36 };

    expect(flattenSubmission(columns, document, answers)).toEqual(["Ada", 36]);
  });

  it("blanks a column the submission's own version never had", () => {
    // The row is not shorter and the values do not shift left — that is the
    // whole point of a fixed column order.
    const v2 = doc([
      { id: "el_name", label: "Name" },
      { id: "el_new", label: "Added later" },
    ]);
    const v1 = doc([{ id: "el_name", label: "Name" }]);
    const columns = columnsFor([v2, v1]);

    expect(flattenSubmission(columns, v1, { el_name: "Ada" })).toEqual([
      "Ada",
      null,
    ]);
  });

  it("still reports an answer to a since-removed field", () => {
    const v2 = doc([{ id: "el_name", label: "Name" }]);
    const v1 = doc([
      { id: "el_name", label: "Name" },
      { id: "el_fax", label: "Fax" },
    ]);
    const columns = columnsFor([v2, v1]);

    expect(
      flattenSubmission(columns, v1, { el_name: "Ada", el_fax: "01234" }),
    ).toEqual(["Ada", "01234"]);
  });

  it("gives every row the same width as the header", () => {
    const v2 = doc([{ id: "el_a" }, { id: "el_b" }]);
    const v1 = doc([{ id: "el_a" }, { id: "el_c" }]);
    const columns = columnsFor([v2, v1]);

    for (const document of [v1, v2, undefined]) {
      expect(flattenSubmission(columns, document, {})).toHaveLength(
        columns.length,
      );
    }
  });
});
