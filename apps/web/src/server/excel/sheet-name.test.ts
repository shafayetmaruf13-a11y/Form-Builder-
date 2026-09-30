import { describe, expect, it } from "vitest";

import { sheetName, uniqueSheetName, workbookFilename } from "./sheet-name";

describe("sheetName", () => {
  it("keeps an ordinary title", () => {
    expect(sheetName("Membership application")).toBe("Membership application");
  });

  it("removes every character Excel forbids", () => {
    // A workbook with an invalid sheet name does not warn — it fails to open.
    for (const bad of ["\\", "/", "?", "*", "[", "]", ":"]) {
      const result = sheetName(`Form ${bad} name`);
      expect(result, bad).not.toContain(bad);
      expect(result, bad).toBe("Form name");
    }
  });

  it("truncates to Excel's 31-character limit", () => {
    const long = "A very long form title that goes well past the limit";
    expect(sheetName(long).length).toBeLessThanOrEqual(31);
    expect(sheetName(long)).toBe("A very long form title that goe");
  });

  it("never returns an empty name", () => {
    expect(sheetName("")).toBe("Responses");
    expect(sheetName("   ")).toBe("Responses");
    expect(sheetName("///")).toBe("Responses");
    expect(sheetName("", "Sheet1")).toBe("Sheet1");
  });

  it("strips wrapping apostrophes, which Excel also rejects", () => {
    expect(sheetName("'quoted'")).toBe("quoted");
  });

  it("collapses control characters and runs of whitespace", () => {
    expect(sheetName("Form\tname\n\nhere")).toBe("Form name here");
  });
});

describe("uniqueSheetName", () => {
  it("leaves a free name alone", () => {
    expect(uniqueSheetName("Responses", new Set())).toBe("Responses");
  });

  it("suffixes a taken name", () => {
    expect(uniqueSheetName("Responses", new Set(["responses"]))).toBe(
      "Responses (2)",
    );
    expect(
      uniqueSheetName("Responses", new Set(["responses", "responses (2)"])),
    ).toBe("Responses (3)");
  });

  it("keeps a suffixed name inside the 31-character limit", () => {
    // Truncating after appending would push the suffix off the end and
    // reintroduce the duplicate.
    const long = "A very long form title that goes past";
    const taken = new Set([sheetName(long).toLowerCase()]);
    const result = uniqueSheetName(long, taken);

    expect(result.length).toBeLessThanOrEqual(31);
    expect(result).toMatch(/\(2\)$/);
  });
});

describe("workbookFilename", () => {
  const when = new Date("2026-09-30T10:00:00Z");

  it("uses the title and the date", () => {
    expect(workbookFilename("Membership application", when)).toBe(
      "Membership-application-2026-09-30.xlsx",
    );
  });

  it("strips anything that could inject a header", () => {
    expect(workbookFilename('Evil"; drop\r\nX-Bad: 1', when)).toBe(
      "Evil-drop-X-Bad-1-2026-09-30.xlsx",
    );
    expect(workbookFilename("../../escape", when)).toBe(
      "escape-2026-09-30.xlsx",
    );
  });

  it("falls back when nothing usable is left", () => {
    expect(workbookFilename("!!!", when)).toBe("form-2026-09-30.xlsx");
  });
});
