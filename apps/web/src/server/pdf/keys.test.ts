import { describe, expect, it } from "vitest";

import {
  UnsafeKeyError,
  submissionPdfFilename,
  submissionPdfKey,
} from "./keys";

describe("submissionPdfKey", () => {
  it("is deterministic and namespaced by version", () => {
    // Rule 4: a PDF belongs to a (submission, version) pair, because a
    // submission always re-renders against the version it was filled against.
    expect(submissionPdfKey("sub_1", "ver_1")).toBe("pdf/ver_1/sub_1.pdf");
    expect(submissionPdfKey("sub_1", "ver_1")).toBe(
      submissionPdfKey("sub_1", "ver_1"),
    );
    expect(submissionPdfKey("sub_1", "ver_2")).not.toBe(
      submissionPdfKey("sub_1", "ver_1"),
    );
  });

  it("accepts a real nanoid", () => {
    expect(() =>
      submissionPdfKey("V1StGXR8_Z5jdHi6B-myT", "cbHF-Rk3aXoPq1_2zYtLm"),
    ).not.toThrow();
  });

  it("refuses anything that could escape the prefix", () => {
    for (const bad of [
      "../../etc/passwd",
      "a/b",
      "a.b",
      "",
      "with space",
      "sub_1\n",
      "%2e%2e%2f",
    ]) {
      expect(() => submissionPdfKey(bad, "ver_1"), bad).toThrow(UnsafeKeyError);
      expect(() => submissionPdfKey("sub_1", bad), bad).toThrow(UnsafeKeyError);
    }
  });
});

describe("submissionPdfFilename", () => {
  const when = new Date("2026-09-30T11:22:33Z");

  it("uses the title and the submission date", () => {
    expect(submissionPdfFilename("Membership form", when)).toBe(
      "Membership-form-2026-09-30.pdf",
    );
  });

  it("strips anything that could inject a header", () => {
    // The title is owner-supplied and lands in Content-Disposition.
    expect(submissionPdfFilename('Evil"; drop\r\nX-Bad: 1', when)).toBe(
      "Evil-drop-X-Bad-1-2026-09-30.pdf",
    );
    expect(submissionPdfFilename("../../escape", when)).toBe(
      "escape-2026-09-30.pdf",
    );
  });

  it("keeps letters from other scripts", () => {
    // Stripping to ASCII would mangle a perfectly reasonable form name.
    expect(submissionPdfFilename("Anmeldung Fragebogen", when)).toBe(
      "Anmeldung-Fragebogen-2026-09-30.pdf",
    );
    expect(submissionPdfFilename("フォーム", when)).toBe(
      "フォーム-2026-09-30.pdf",
    );
  });

  it("falls back when a title has nothing usable left", () => {
    expect(submissionPdfFilename("!!!", when)).toBe("form-2026-09-30.pdf");
    expect(submissionPdfFilename("", when)).toBe("form-2026-09-30.pdf");
  });
});
