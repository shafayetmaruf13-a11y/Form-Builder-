/**
 * Naming and staleness helpers.
 *
 * Pure, so the two bits of Slice 3 that are easy to get quietly wrong — what a
 * duplicate is called, and whether a save is about to clobber someone — can be
 * tested without a database.
 */

const COPY_SUFFIX = /^(.*?)(?: \(copy(?: (\d+))?\))$/;

/**
 * The title for a duplicate.
 *
 * "Form" becomes "Form (copy)", and duplicating that gives "Form (copy 2)"
 * rather than "Form (copy) (copy)". Existing titles are passed in so the number
 * skips ones already taken.
 */
export function copyTitle(
  title: string,
  existing: readonly string[] = [],
): string {
  const match = COPY_SUFFIX.exec(title);
  const base = match ? (match[1] ?? title) : title;

  const taken = new Set(existing);
  const first = `${base} (copy)`;
  if (!taken.has(first)) return first;

  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} (copy ${n})`;
    if (!taken.has(candidate)) return candidate;
  }

  return `${base} (copy)`;
}

/**
 * Whether a save would overwrite someone else's work.
 *
 * Autosave sends the `updatedAt` it last saw. If the row has moved on since,
 * another tab (or another person, once there is auth) has written in the
 * meantime, and writing anyway would silently discard their edit — which the
 * quality bar's "nothing is ever lost" forbids.
 *
 * Timestamps are compared as milliseconds, because they cross the wire as ISO
 * strings and come back from Postgres as Dates.
 */
export function isStale(
  expected: string | Date | null | undefined,
  actual: Date,
): boolean {
  // No expectation sent: the client is not claiming to know, so let it write.
  if (expected === null || expected === undefined) return false;

  const expectedMs = new Date(expected).getTime();
  // An unparseable timestamp is not a claim we can honour.
  if (Number.isNaN(expectedMs)) return true;

  // Both sides are millisecond-precision: Drizzle hands back a JS Date, and an
  // ISO string round trip keeps milliseconds. So "what I last saw" either is
  // the current value or it isn't.
  return expectedMs !== actual.getTime();
}
