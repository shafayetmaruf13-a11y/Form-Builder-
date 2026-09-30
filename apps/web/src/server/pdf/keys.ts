/**
 * Object keys for rendered PDFs.
 *
 * Deterministic, and derived only from ids we generated: a submission id and a
 * version id are both nanoids, so a key can never contain anything a stranger
 * typed. The uploads path learned this the hard way — a key built from a
 * supplied filename is a path traversal and an overwrite waiting to happen.
 *
 * The version id is in the path on purpose. Rule 4 says a submission always
 * re-renders against the version it was filled against, so a PDF belongs to a
 * (submission, version) pair rather than to a submission alone. If a future
 * slice ever re-renders one against a different version, the two cannot
 * silently overwrite each other.
 */

/** nanoid's alphabet, plus nothing. Anything else is not one of our ids. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export class UnsafeKeyError extends Error {}

export function submissionPdfKey(
  submissionId: string,
  formVersionId: string,
): string {
  // Thrown rather than sanitised: a value failing this did not come from our
  // database, so the interesting question is how it got here, not how to make
  // it fit.
  if (!ID.test(submissionId)) {
    throw new UnsafeKeyError(`unsafe submission id: ${submissionId}`);
  }
  if (!ID.test(formVersionId)) {
    throw new UnsafeKeyError(`unsafe version id: ${formVersionId}`);
  }

  return `pdf/${formVersionId}/${submissionId}.pdf`;
}

/** The filename a browser should save a download as. */
export function submissionPdfFilename(
  formTitle: string,
  submittedAt: Date,
): string {
  const date = submittedAt.toISOString().slice(0, 10);

  // The title comes from a form owner and ends up in a Content-Disposition
  // header, so everything outside a small allowlist goes — a quote or a
  // newline there is a header injection.
  //
  // Disallowed characters collapse to a separator rather than vanishing: a
  // stripped newline would otherwise weld the words either side of it
  // together, turning "drop\r\nX-Bad" into "dropX-Bad".
  const safe = formTitle
    .replace(/[^\p{L}\p{N} _-]/gu, " ")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 60)
    .replace(/-+$/, "");

  return `${safe || "form"}-${date}.pdf`;
}
