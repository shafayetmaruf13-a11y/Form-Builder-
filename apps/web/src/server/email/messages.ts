import {
  type Answers,
  type FormDocument,
  type InputElement,
  answerToString,
  inputElements,
  resolveVisibility,
} from "@formcraft/schema";

/**
 * What the emails say.
 *
 * Pure, so the wording can be tested without sending anything — which matters
 * more than usual here, because `api.resend.com` is refused by this
 * container's network policy and no real delivery can be observed.
 *
 * Every message is built as text *and* HTML. A text part is not a courtesy:
 * an HTML-only message scores badly with spam filters, and the whole point of
 * this slice is that the owner actually receives their submissions.
 */

export interface Message {
  subject: string;
  text: string;
  html: string;
}

/** Escapes a value for interpolation into HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A short summary of the answers, for the body of the email.
 *
 * Capped: an email is a notification, not the record — the attached PDF is the
 * record. A form with sixty questions should not produce a mail nobody scrolls
 * to the end of.
 */
const SUMMARY_FIELDS = 8;
const SUMMARY_VALUE_CHARS = 120;

export function summarise(
  document: FormDocument | undefined,
  answers: Answers,
): { label: string; value: string }[] {
  if (!document) return [];

  // Only what was actually asked — the same rule the PDF and the single
  // submission's workbook follow.
  const { visible } = resolveVisibility(document, answers);

  return inputElements(document)
    .filter((element) => visible.has(element.id))
    .map((element) => ({
      label: element.label.trim() || element.id,
      value: valueFor(element, answers[element.id]),
    }))
    .filter((row) => row.value !== "")
    .slice(0, SUMMARY_FIELDS);
}

function valueFor(
  element: InputElement,
  answer: Answers[string] | undefined,
): string {
  if (element.type === "signature") {
    const text = answerToString(answer);
    // Never the data URL: it is 15KB of base64 and would swamp the message.
    return text.startsWith("data:image/") ? "(signed)" : "";
  }

  // Option *labels*, for the same reason the Excel export uses them: this is
  // read by a person, and they chose "United Kingdom" — "gb" is a detail of
  // how it is stored.
  const text =
    element.type === "select" ||
    element.type === "radioGroup" ||
    element.type === "checkboxGroup"
      ? labelsFor(element, answer)
      : answerToString(answer);

  return text.length > SUMMARY_VALUE_CHARS
    ? `${text.slice(0, SUMMARY_VALUE_CHARS)}…`
    : text;
}

function labelsFor(
  element: Extract<
    InputElement,
    { type: "select" | "radioGroup" | "checkboxGroup" }
  >,
  answer: Answers[string] | undefined,
): string {
  const chosen = Array.isArray(answer)
    ? answer.filter((item): item is string => typeof item === "string")
    : [answerToString(answer)];

  return chosen
    .filter((value) => value !== "")
    .map(
      (value) =>
        // A value that is no longer an option falls back to itself rather
        // than disappearing — the same rule the spreadsheet follows.
        element.options.find((option) => option.value === value)?.label ??
        value,
    )
    .join(", ");
}

function layout(
  heading: string,
  intro: string,
  rows: { label: string; value: string }[],
  footer: string,
): string {
  const table = rows
    .map(
      (row) => `
        <tr>
          <td style="padding:6px 12px 6px 0;color:#475569;vertical-align:top;white-space:nowrap">${escapeHtml(row.label)}</td>
          <td style="padding:6px 0;color:#0f172a">${escapeHtml(row.value)}</td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
    <h1 style="margin:0 0 8px;font-size:18px;color:#0f172a">${escapeHtml(heading)}</h1>
    <p style="margin:0 0 16px;color:#475569;line-height:1.5">${escapeHtml(intro)}</p>
    ${rows.length > 0 ? `<table style="border-collapse:collapse;font-size:14px;width:100%">${table}</table>` : ""}
    <p style="margin:16px 0 0;color:#64748b;font-size:13px;line-height:1.5">${escapeHtml(footer)}</p>
  </div>
</body></html>`;
}

function textLayout(
  heading: string,
  intro: string,
  rows: { label: string; value: string }[],
  footer: string,
): string {
  const body = rows.map((row) => `${row.label}: ${row.value}`).join("\n");
  return [heading, "", intro, "", body, "", footer]
    .filter((part) => part !== undefined)
    .join("\n");
}

/**
 * The sign-in link.
 *
 * Lives here with the others so there is one place that knows what this app's
 * email looks like, and so it is logged like the others.
 */
export function signInMessage(url: string): Message {
  const intro =
    "Use the link below to sign in. It expires in 24 hours, and can only be used once.";
  const footer =
    "If you did not ask to sign in, you can ignore this message — nothing will happen without the link being used.";

  return {
    subject: "Your Formcraft sign-in link",
    text: ["Sign in to Formcraft", "", intro, "", url, "", footer].join("\n"),
    html: `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
    <h1 style="margin:0 0 8px;font-size:18px;color:#0f172a">Sign in to Formcraft</h1>
    <p style="margin:0 0 20px;color:#475569;line-height:1.5">${escapeHtml(intro)}</p>
    <p style="margin:0 0 20px">
      <a href="${escapeHtml(url)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Sign in</a>
    </p>
    <p style="margin:0;color:#64748b;font-size:13px;line-height:1.5">${escapeHtml(footer)}</p>
  </div>
</body></html>`,
  };
}

/** Sent to the form's owner when somebody fills it in. */
export function newSubmissionMessage({
  formTitle,
  document,
  answers,
  submittedAt,
  hasPdf,
}: {
  formTitle: string;
  document: FormDocument | undefined;
  answers: Answers;
  submittedAt: Date;
  /** False when the PDF could not be rendered; the mail still goes. */
  hasPdf: boolean;
}): Message {
  const rows = summarise(document, answers);
  const total = document ? inputElements(document).length : 0;

  const intro = `${formTitle} was filled in on ${submittedAt.toISOString().slice(0, 16).replace("T", " ")} UTC.`;
  const footer = hasPdf
    ? "The complete response is attached as a PDF, laid out exactly as the form was designed."
    : "The PDF could not be rendered for this response; open it in Formcraft to see it in full.";

  const shown = rows.length;
  const more = total > shown ? `\n\nShowing ${shown} of ${total} fields.` : "";

  return {
    // The form's name first: an owner with several forms sorts by subject.
    subject: `${formTitle}: new response`,
    text: textLayout("New response", intro, rows, footer + more),
    html: layout("New response", intro, rows, footer + more.trim()),
  };
}

/** Sent when the owner forwards a response to somebody. */
export function forwardedSubmissionMessage({
  formTitle,
  document,
  answers,
  submittedAt,
  note,
  senderName,
}: {
  formTitle: string;
  document: FormDocument | undefined;
  answers: Answers;
  submittedAt: Date;
  note: string;
  senderName: string;
}): Message {
  const rows = summarise(document, answers);

  const intro = note.trim()
    ? note.trim()
    : `${senderName} has shared a response to ${formTitle} with you.`;

  const footer =
    `This response was submitted on ${submittedAt.toISOString().slice(0, 10)} and is attached as a PDF. ` +
    `It was sent to you by ${senderName} through Formcraft.`;

  return {
    subject: `${formTitle}: a response has been shared with you`,
    text: textLayout("A shared response", intro, rows, footer),
    html: layout("A shared response", intro, rows, footer),
  };
}
