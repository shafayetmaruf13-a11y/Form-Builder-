import {
  SCHEMA_VERSION,
  createElement,
  formDocumentSchema,
} from "@formcraft/schema";
import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  forwardedSubmissionMessage,
  newSubmissionMessage,
  summarise,
} from "./messages";

function doc(
  specs: {
    id: string;
    label: string;
    type?: "textInput" | "signature" | "select";
    extra?: object;
  }[],
) {
  return formDocumentSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: "doc_1",
    title: "Test",
    pages: [
      {
        id: "page_1",
        elements: specs.map((spec, index) => ({
          ...createElement(spec.type ?? "textInput", spec.id, {
            x: 0,
            y: index * 80,
          }),
          label: spec.label,
          ...spec.extra,
        })),
      },
    ],
  });
}

const WHEN = new Date("2026-10-01T09:30:00Z");

describe("escapeHtml", () => {
  it("neutralises anything that could close a tag", () => {
    // Answers are attacker-supplied: a public fill page takes text from
    // anybody with the link, and it lands in an HTML email.
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    expect(escapeHtml("a & b")).toBe("a &amp; b");
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });
});

describe("summarise", () => {
  it("lists answered fields with their labels", () => {
    const document = doc([
      { id: "el_a", label: "Full name" },
      { id: "el_b", label: "Email" },
    ]);

    expect(
      summarise(document, { el_a: "Ada", el_b: "ada@example.com" }),
    ).toEqual([
      { label: "Full name", value: "Ada" },
      { label: "Email", value: "ada@example.com" },
    ]);
  });

  it("leaves out unanswered fields", () => {
    const document = doc([
      { id: "el_a", label: "Full name" },
      { id: "el_b", label: "Email" },
    ]);

    expect(summarise(document, { el_a: "Ada" })).toEqual([
      { label: "Full name", value: "Ada" },
    ]);
  });

  it("leaves out a field a condition hid", () => {
    // The same rule the PDF and the workbook follow: it was never asked.
    const document = doc([
      {
        id: "el_target",
        label: "Country",
        type: "select",
        extra: { options: [{ id: "o", label: "Other", value: "other" }] },
      },
      {
        id: "el_dependent",
        label: "Which country?",
        extra: {
          conditional: {
            targetId: "el_target",
            operator: "equals",
            value: "other",
          },
        },
      },
    ]);

    const rows = summarise(document, {
      el_target: "",
      el_dependent: "Atlantis",
    });
    expect(rows.map((r) => r.label)).not.toContain("Which country?");
  });

  it("shows a choice by its label, not its stored value", () => {
    // The same reason the Excel export does: somebody chose "United Kingdom".
    // "gb" is a detail of how we keep it, and reads like a bug in an email.
    const document = doc([
      {
        id: "el_country",
        label: "Country",
        type: "select",
        extra: {
          options: [
            { id: "o1", label: "United Kingdom", value: "gb" },
            { id: "o2", label: "Other", value: "other" },
          ],
        },
      },
    ]);

    expect(summarise(document, { el_country: "gb" })).toEqual([
      { label: "Country", value: "United Kingdom" },
    ]);
  });

  it("falls back to the raw value for a choice that is no longer an option", () => {
    const document = doc([
      {
        id: "el_country",
        label: "Country",
        type: "select",
        extra: {
          options: [{ id: "o1", label: "United Kingdom", value: "gb" }],
        },
      },
    ]);

    expect(summarise(document, { el_country: "removed" })).toEqual([
      { label: "Country", value: "removed" },
    ]);
  });

  it("never puts a signature's data URL in the body", () => {
    const document = doc([
      { id: "el_s", label: "Signature", type: "signature" },
    ]);

    expect(
      summarise(document, { el_s: "data:image/png;base64,iVBORw0KGgo=" }),
    ).toEqual([{ label: "Signature", value: "(signed)" }]);
  });

  it("truncates a very long answer", () => {
    const document = doc([{ id: "el_a", label: "Essay" }]);
    const long = "x".repeat(500);

    const value = summarise(document, { el_a: long })[0]!.value;
    expect(value.length).toBeLessThan(200);
    expect(value.endsWith("…")).toBe(true);
  });

  it("caps how many fields it lists", () => {
    // An email is a notification; the attached PDF is the record.
    const document = doc(
      Array.from({ length: 30 }, (_, i) => ({ id: `el_${i}`, label: `Q${i}` })),
    );
    const answers = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`el_${i}`, "answered"]),
    );

    expect(summarise(document, answers).length).toBeLessThanOrEqual(8);
  });

  it("copes with no document at all", () => {
    expect(summarise(undefined, { el_a: "x" })).toEqual([]);
  });
});

describe("newSubmissionMessage", () => {
  const document = doc([{ id: "el_a", label: "Full name" }]);

  it("names the form in the subject", () => {
    // An owner with several forms sorts by subject.
    const message = newSubmissionMessage({
      formTitle: "Membership application",
      document,
      answers: { el_a: "Ada" },
      submittedAt: WHEN,
      hasPdf: true,
    });

    expect(message.subject).toBe("Membership application: new response");
  });

  it("has both a text and an HTML part", () => {
    // HTML-only mail scores badly with spam filters, and the point of this
    // slice is that the owner actually receives it.
    const message = newSubmissionMessage({
      formTitle: "Form",
      document,
      answers: { el_a: "Ada" },
      submittedAt: WHEN,
      hasPdf: true,
    });

    expect(message.text).toContain("Ada");
    expect(message.html).toContain("Ada");
    expect(message.html).toContain("<!doctype html>");
    expect(message.text).not.toContain("<");
  });

  it("escapes an answer rather than letting it into the markup", () => {
    const message = newSubmissionMessage({
      formTitle: "Form",
      document,
      answers: { el_a: "<img src=x onerror=alert(1)>" },
      submittedAt: WHEN,
      hasPdf: true,
    });

    expect(message.html).not.toContain("<img src=x");
    expect(message.html).toContain("&lt;img src=x");
  });

  it("escapes the form's own title too", () => {
    // Owner-supplied, and it reaches the heading.
    const message = newSubmissionMessage({
      formTitle: "<b>Bold</b>",
      document,
      answers: {},
      submittedAt: WHEN,
      hasPdf: true,
    });

    expect(message.html).not.toContain("<b>Bold</b>");
  });

  it("says so when the PDF could not be rendered", () => {
    const withPdf = newSubmissionMessage({
      formTitle: "Form",
      document,
      answers: {},
      submittedAt: WHEN,
      hasPdf: true,
    });
    const without = newSubmissionMessage({
      formTitle: "Form",
      document,
      answers: {},
      submittedAt: WHEN,
      hasPdf: false,
    });

    expect(withPdf.text).toContain("attached");
    expect(without.text).toContain("could not be rendered");
  });

  it("says how many fields it is not showing", () => {
    const many = doc(
      Array.from({ length: 20 }, (_, i) => ({ id: `el_${i}`, label: `Q${i}` })),
    );
    const answers = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`el_${i}`, "x"]),
    );

    const message = newSubmissionMessage({
      formTitle: "Form",
      document: many,
      answers,
      submittedAt: WHEN,
      hasPdf: true,
    });

    expect(message.text).toMatch(/Showing 8 of 20 fields/);
  });
});

describe("forwardedSubmissionMessage", () => {
  const document = doc([{ id: "el_a", label: "Full name" }]);

  it("uses the sender's note when there is one", () => {
    const message = forwardedSubmissionMessage({
      formTitle: "Form",
      document,
      answers: { el_a: "Ada" },
      submittedAt: WHEN,
      note: "Please review before Friday.",
      senderName: "dev@formcraft.local",
    });

    expect(message.text).toContain("Please review before Friday.");
  });

  it("falls back to a plain sentence with no note", () => {
    const message = forwardedSubmissionMessage({
      formTitle: "Membership",
      document,
      answers: {},
      submittedAt: WHEN,
      note: "   ",
      senderName: "dev@formcraft.local",
    });

    expect(message.text).toContain("dev@formcraft.local");
    expect(message.text).toContain("Membership");
  });

  it("says who sent it, so the recipient knows why they got it", () => {
    // Mail from a domain they have never heard of, about a form they did not
    // fill in, needs to explain itself or it is indistinguishable from spam.
    const message = forwardedSubmissionMessage({
      formTitle: "Form",
      document,
      answers: {},
      submittedAt: WHEN,
      note: "",
      senderName: "owner@example.com",
    });

    expect(message.text).toContain("sent to you by owner@example.com");
  });

  it("escapes a hostile note", () => {
    const message = forwardedSubmissionMessage({
      formTitle: "Form",
      document,
      answers: {},
      submittedAt: WHEN,
      note: "<script>x</script>",
      senderName: "a@b.c",
    });

    expect(message.html).not.toContain("<script>");
  });
});
