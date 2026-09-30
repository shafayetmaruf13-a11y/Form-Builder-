import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderOrigin, renderToken, renderTokenValid } from "./render-token";

const SUBMISSION = "BUiTspB7yIW3yY6khCdI6";
const OTHER = "cbHF-Rk3aXoPq1_2zYtLm";

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-not-a-real-one";
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.RENDER_ORIGIN;
  delete process.env.PORT;
});

describe("renderToken", () => {
  it("authorises the submission it was minted for", () => {
    expect(renderTokenValid(SUBMISSION, renderToken(SUBMISSION))).toBe(true);
  });

  it("does not authorise a different submission", () => {
    // The whole reason the token is per-submission rather than one shared
    // secret: a leaked URL must not become a key to every response.
    expect(renderTokenValid(OTHER, renderToken(SUBMISSION))).toBe(false);
  });

  it("refuses a missing, empty or malformed token", () => {
    for (const bad of [null, "", ".", "abc", "notanumber.deadbeef", "123"]) {
      expect(renderTokenValid(SUBMISSION, bad), String(bad)).toBe(false);
    }
  });

  it("refuses a tampered signature", () => {
    const token = renderToken(SUBMISSION);
    const [expiry, signature] = token.split(".");

    expect(renderTokenValid(SUBMISSION, `${expiry}.${"0".repeat(64)}`)).toBe(
      false,
    );
    // Moving the expiry invalidates it, because the expiry is signed.
    expect(
      renderTokenValid(SUBMISSION, `${Number(expiry) + 60_000}.${signature}`),
    ).toBe(false);
  });

  it("expires", () => {
    vi.useFakeTimers();
    const token = renderToken(SUBMISSION);

    vi.advanceTimersByTime(60 * 1000);
    expect(renderTokenValid(SUBMISSION, token)).toBe(true);

    vi.advanceTimersByTime(3 * 60 * 1000);
    expect(renderTokenValid(SUBMISSION, token)).toBe(false);
  });

  it("does not validate against a different secret", () => {
    const token = renderToken(SUBMISSION);
    process.env.AUTH_SECRET = "a-completely-different-secret";

    expect(renderTokenValid(SUBMISSION, token)).toBe(false);
  });

  it("refuses to work at all with no secret", () => {
    // A default key would be worse than no check, because it would look like
    // one.
    delete process.env.AUTH_SECRET;

    expect(() => renderToken(SUBMISSION)).toThrow(/AUTH_SECRET/);
  });

  it("survives being derived twice, in separate module graphs", () => {
    // The bug this replaced: a token generated once at import time exists
    // twice in one Next.js process — the route handler and the RSC page are
    // separate module graphs — with two different values. A derived token has
    // no state to disagree about, so signing and verifying independently
    // agree.
    vi.useFakeTimers();
    const first = renderToken(SUBMISSION);
    const second = renderToken(SUBMISSION);

    expect(first).toBe(second);
    expect(renderTokenValid(SUBMISSION, first)).toBe(true);
    expect(renderTokenValid(SUBMISSION, second)).toBe(true);
  });
});

describe("renderOrigin", () => {
  it("is loopback by default", () => {
    // Never the request's Host header: our own browser carries our own token,
    // so a caller-chosen origin would hand it to them.
    expect(renderOrigin()).toBe("http://127.0.0.1:3000");
  });

  it("follows PORT", () => {
    process.env.PORT = "4001";
    expect(renderOrigin()).toBe("http://127.0.0.1:4001");
  });

  it("can be set explicitly", () => {
    process.env.RENDER_ORIGIN = "http://renderer.internal:8080";
    expect(renderOrigin()).toBe("http://renderer.internal:8080");
  });
});
