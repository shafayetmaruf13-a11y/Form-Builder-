import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  emailLog,
  formLinks,
  formVersions,
  forms,
  submissions,
  uploads,
  users,
} from "./schema";

/**
 * An index's columns are typed as `SQL | IndexedColumn` because an index can be
 * over an expression rather than a plain column. Every index in this schema is
 * over plain columns, so narrow to the named ones.
 */
function indexColumnNames(index: {
  config: { columns: readonly unknown[] };
}): string[] {
  return index.config.columns.flatMap((column) =>
    typeof column === "object" &&
    column !== null &&
    "name" in column &&
    typeof column.name === "string"
      ? [column.name]
      : [],
  );
}

/**
 * These aren't tests of Drizzle — they pin down the schema decisions that the
 * rest of the system quietly depends on, so that breaking one fails here rather
 * than three slices later in a PDF that no longer matches its submission.
 */
describe("database schema", () => {
  it("defines the seven tables from the data model", () => {
    const names = [
      users,
      forms,
      formVersions,
      formLinks,
      submissions,
      uploads,
      emailLog,
    ].map(getTableName);

    expect(names).toEqual([
      "users",
      "forms",
      "form_versions",
      "form_links",
      "submissions",
      "uploads",
      "email_log",
    ]);
  });

  it("uses text primary keys everywhere, never serial", () => {
    // Architecture rule 6: no sequential identifiers on public surfaces.
    for (const table of [
      users,
      forms,
      formVersions,
      formLinks,
      submissions,
      uploads,
      emailLog,
    ]) {
      const { columns } = getTableConfig(table);
      const primaryKey = columns.find((column) => column.primary);

      expect(
        primaryKey,
        `${getTableName(table)} has a primary key`,
      ).toBeDefined();
      expect(primaryKey?.getSQLType(), getTableName(table)).toBe("text");
    }
  });

  it("stores form content as jsonb rather than normalised tables", () => {
    // Architecture rule 1: a form is a JSON document, not a page.
    const jsonbColumns: [string, string][] = [];
    for (const table of [forms, formVersions, submissions]) {
      const { columns } = getTableConfig(table);
      for (const column of columns) {
        if (column.getSQLType() === "jsonb") {
          jsonbColumns.push([getTableName(table), column.name]);
        }
      }
    }

    expect(jsonbColumns).toEqual([
      ["forms", "draft_document"],
      ["form_versions", "document"],
      ["submissions", "answers"],
    ]);
  });

  it("numbers versions uniquely per form", () => {
    // Architecture rule 4: a published version is immutable and addressable.
    const { indexes } = getTableConfig(formVersions);
    const unique = indexes.find((index) => index.config.unique);

    expect(unique && indexColumnNames(unique)).toEqual(["form_id", "version"]);
  });

  it("keeps share slugs unique", () => {
    const { indexes } = getTableConfig(formLinks);
    const slugIndex = indexes.find((index) =>
      indexColumnNames(index).includes("slug"),
    );

    expect(slugIndex?.config.unique).toBe(true);
  });

  it("points every submission at the exact version it was filled against", () => {
    const { foreignKeys } = getTableConfig(submissions);
    const references = foreignKeys.map((key) => {
      const { columns, foreignColumns } = key.reference();
      return {
        from: columns.map((column) => column.name),
        to: foreignColumns.map((column) => column.name),
        table: getTableName(foreignColumns[0]!.table),
      };
    });

    expect(references).toContainEqual({
      from: ["form_version_id"],
      to: ["id"],
      table: "form_versions",
    });
  });
});
