/**
 * Excel sheet names.
 *
 * A worksheet name is not free text, and the rules are Excel's, not ours:
 * at most 31 characters, none of `\ / ? * [ ] :`, and it may not be blank.
 * A workbook with an invalid name does not warn — it fails to open, which is
 * the worst possible moment to find out.
 *
 * Form titles are owner-supplied and reach here directly, so this is a
 * sanitiser rather than a validator.
 */

const MAX_LENGTH = 31;
/** Excel's own forbidden set, plus control characters. */
const FORBIDDEN = /[\\/?*[\]:]/g;

export function sheetName(title: string, fallback = "Responses"): string {
  const cleaned = title
    .replace(FORBIDDEN, " ")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Excel also rejects a name wrapped in apostrophes.
    .replace(/^'+|'+$/g, "")
    .trim()
    .slice(0, MAX_LENGTH)
    .trim();

  return cleaned || fallback;
}

/**
 * Makes a name unique within a workbook, since Excel rejects duplicates.
 *
 * Truncates before appending the suffix rather than after, so the result still
 * fits in 31 characters.
 */
export function uniqueSheetName(
  desired: string,
  taken: ReadonlySet<string>,
): string {
  const base = sheetName(desired);
  if (!taken.has(base.toLowerCase())) return base;

  for (let n = 2; n < 1000; n++) {
    const suffix = ` (${n})`;
    const candidate = base.slice(0, MAX_LENGTH - suffix.length).trim() + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }

  return base.slice(0, MAX_LENGTH - 6).trim() + " (999)";
}

/** The filename a browser should save a workbook as. */
export function workbookFilename(title: string, when: Date): string {
  const date = when.toISOString().slice(0, 10);

  // Lands in a Content-Disposition header, so everything outside a small
  // allowlist becomes a separator — a quote or a newline there is a header
  // injection, and a stripped one would weld the words either side together.
  const safe = title
    .replace(/[^\p{L}\p{N} _-]/gu, " ")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 60)
    .replace(/-+$/, "");

  return `${safe || "form"}-${date}.xlsx`;
}
