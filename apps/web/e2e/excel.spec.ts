import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";

import { seed } from "./helpers";

/**
 * Slice 7: the exports.
 *
 * Every assertion reads the workbook back, because the thing that matters is
 * not what the sheet looks like but what type each cell holds. A column of
 * text dates sorts alphabetically and `=SUM()` over text numbers is zero —
 * the difference between a spreadsheet and a CSV that has been renamed.
 */

async function workbookFrom(body: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body as unknown as ArrayBuffer);
  return workbook;
}

test.describe("every response as one sheet", () => {
  test("is a real xlsx, served as one", async ({ request }) => {
    const response = await request.get(`/api/forms/${seed().formId}/xlsx`);

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("spreadsheetml.sheet");

    const body = Buffer.from(await response.body());
    // A zip, which is what an xlsx is.
    expect(body.subarray(0, 2).toString("hex")).toBe("504b");
  });

  test("carries real Excel types, not text", async ({ request }) => {
    const response = await request.get(`/api/forms/${seed().formId}/xlsx`);
    const sheet = (await workbookFrom(Buffer.from(await response.body())))
      .worksheets[0]!;

    const header = (sheet.getRow(1).values as unknown[])
      .slice(1)
      .map((value) => String(value));

    expect(header.slice(0, 3)).toEqual([
      "Submitted",
      "Version",
      "Submission ID",
    ]);

    const rows: ExcelJS.Row[] = [];
    sheet.eachRow((row, n) => {
      if (n > 1) rows.push(row);
    });
    expect(rows.length).toBeGreaterThan(0);

    const column = (name: string) => header.indexOf(name) + 1;
    const firstWith = (index: number) =>
      rows.find((row) => row.getCell(index).value !== null)?.getCell(index);

    expect(
      rows[0]!.getCell(1).value,
      "Submitted should be a Date",
    ).toBeInstanceOf(Date);

    const age = firstWith(column("Age"));
    expect(typeof age?.value, "a number field should be a number").toBe(
      "number",
    );

    const dob = firstWith(column("Date of birth"));
    expect(dob?.value, "a date field should be a Date").toBeInstanceOf(Date);

    const declaration = firstWith(column("Declaration"));
    expect(typeof declaration?.value, "a checkbox should be a boolean").toBe(
      "boolean",
    );
  });

  test("shows choices by their label, and never a signature's data URL", async ({
    request,
  }) => {
    const response = await request.get(`/api/forms/${seed().formId}/xlsx`);
    const sheet = (await workbookFrom(Buffer.from(await response.body())))
      .worksheets[0]!;

    const header = (sheet.getRow(1).values as unknown[])
      .slice(1)
      .map((value) => String(value));

    const rows: ExcelJS.Row[] = [];
    sheet.eachRow((row, n) => {
      if (n > 1) rows.push(row);
    });

    const valueIn = (name: string) => {
      const index = header.indexOf(name) + 1;
      return rows.find((row) => row.getCell(index).value)?.getCell(index).value;
    };

    // Somebody chose "United Kingdom"; "gb" is a detail of how it is stored.
    expect(valueIn("Country")).toBe("United Kingdom");
    expect(String(valueIn("Interests"))).toContain("Talks and lectures");

    // 15KB of base64 in a cell is unusable.
    expect(valueIn("Signature")).toBe("(signed)");
  });

  test("freezes the header and filters every column", async ({ request }) => {
    const response = await request.get(`/api/forms/${seed().formId}/xlsx`);
    const sheet = (await workbookFrom(Buffer.from(await response.body())))
      .worksheets[0]!;

    expect(sheet.views?.[0]?.state).toBe("frozen");
    expect(sheet.autoFilter).toBeTruthy();
  });

  test("keeps the sheet name inside Excel's limits", async ({ request }) => {
    // A workbook with an invalid sheet name does not warn — it fails to open.
    const response = await request.get(`/api/forms/${seed().formId}/xlsx`);
    const sheet = (await workbookFrom(Buffer.from(await response.body())))
      .worksheets[0]!;

    expect(sheet.name.length).toBeLessThanOrEqual(31);
    expect(sheet.name).not.toMatch(/[\\/?*[\]:]/);
  });
});

test.describe("one response as a workbook", () => {
  test("reads as question and answer pairs, in reading order", async ({
    request,
  }) => {
    const response = await request.get(
      `/api/submissions/${seed().submissionId}/xlsx`,
    );
    expect(response.status()).toBe(200);

    const sheet = (await workbookFrom(Buffer.from(await response.body())))
      .worksheets[0]!;

    const pairs: [string, unknown][] = [];
    sheet.eachRow((row) => {
      pairs.push([String(row.getCell(1).value), row.getCell(2).value]);
    });

    expect(pairs[0]).toEqual(["Question", "Answer"]);
    expect(pairs.map(([key]) => key)).toContain("Submission ID");

    const labels = pairs.map(([key]) => key);
    expect(labels.indexOf("Full name")).toBeLessThan(
      labels.indexOf("Signature"),
    );
  });

  test("leaves out a field a condition hid, exactly as the PDF does", async ({
    request,
  }) => {
    const response = await request.get(
      `/api/submissions/${seed().submissionId}/xlsx`,
    );
    const sheet = (await workbookFrom(Buffer.from(await response.body())))
      .worksheets[0]!;

    const labels: string[] = [];
    sheet.eachRow((row) => labels.push(String(row.getCell(1).value)));

    // The question was never asked, so a blank beside it would claim it went
    // unanswered.
    expect(labels).not.toContain("Which country?");
    expect(labels).toContain("Country");
  });
});

test.describe("exports are permission-checked", () => {
  test("an unknown form or submission is a 404", async ({ request }) => {
    for (const url of [
      "/api/forms/does-not-exist/xlsx",
      "/api/submissions/does-not-exist/xlsx",
    ]) {
      const response = await request.get(url, { failOnStatusCode: false });
      expect(response.status(), url).toBe(404);
    }
  });
});
