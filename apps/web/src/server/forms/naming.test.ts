import { describe, expect, it } from "vitest";

import { copyTitle, isStale } from "./naming";

describe("copyTitle", () => {
  it("appends (copy)", () => {
    expect(copyTitle("Membership form")).toBe("Membership form (copy)");
  });

  it("does not stack suffixes", () => {
    // "Form (copy) (copy)" is how this goes wrong, and it goes wrong fast.
    expect(copyTitle("Form (copy)")).toBe("Form (copy)");
    expect(copyTitle("Form (copy)", ["Form (copy)"])).toBe("Form (copy 2)");
    expect(copyTitle("Form (copy 2)", ["Form (copy)"])).toBe("Form (copy 2)");
  });

  it("skips numbers already taken", () => {
    expect(
      copyTitle("Form", ["Form (copy)", "Form (copy 2)", "Form (copy 3)"]),
    ).toBe("Form (copy 4)");
  });

  it("leaves an unrelated parenthetical alone", () => {
    expect(copyTitle("Form (2026)")).toBe("Form (2026) (copy)");
  });

  it("handles an empty title", () => {
    expect(copyTitle("")).toBe(" (copy)");
  });
});

describe("isStale", () => {
  const now = new Date("2026-09-21T10:00:00.000Z");

  it("passes when the client echoes what is stored", () => {
    expect(isStale(now.toISOString(), now)).toBe(false);
    expect(isStale(now, now)).toBe(false);
  });

  it("rejects when the row has moved on", () => {
    // Another tab wrote in between. Saving anyway would discard their edit.
    const later = new Date(now.getTime() + 1000);
    expect(isStale(now.toISOString(), later)).toBe(true);
  });

  it("rejects a client claiming a newer timestamp than exists", () => {
    // Not a case we expect, but it means the client's belief is wrong either
    // way, so writing on it is unsafe.
    const earlier = new Date(now.getTime() - 1000);
    expect(isStale(now.toISOString(), earlier)).toBe(true);
  });

  it("allows a save that makes no claim", () => {
    expect(isStale(null, now)).toBe(false);
    expect(isStale(undefined, now)).toBe(false);
  });

  it("rejects an unparseable claim", () => {
    expect(isStale("not a date", now)).toBe(true);
  });

  it("survives a JSON round trip", () => {
    const echoed = JSON.parse(JSON.stringify({ at: now })).at as string;
    expect(isStale(echoed, now)).toBe(false);
  });
});
