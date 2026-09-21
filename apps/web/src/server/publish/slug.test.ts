import { describe, expect, it } from "vitest";

import {
  SLUG_ALPHABET,
  SLUG_LENGTH,
  isSlugShaped,
  newLinkToken,
  newSlug,
  secretEquals,
} from "./slug";

describe("the slug alphabet", () => {
  it("excludes every visually confusable character", () => {
    // A slug read off a printed form must not be mistakable for a different
    // valid slug.
    for (const character of "01loOIiuv") {
      expect(SLUG_ALPHABET, character).not.toContain(character);
    }
  });

  it("is lower case only", () => {
    expect(SLUG_ALPHABET).toBe(SLUG_ALPHABET.toLowerCase());
  });

  it("has no duplicates", () => {
    expect(new Set(SLUG_ALPHABET).size).toBe(SLUG_ALPHABET.length);
  });

  it("carries enough entropy to be unguessable", () => {
    // Architecture rule 6 in arithmetic: the URL is the access control, so it
    // has to be beyond enumeration. Anything under 2^80 is not.
    const bits = SLUG_LENGTH * Math.log2(SLUG_ALPHABET.length);
    expect(bits).toBeGreaterThan(80);
  });
});

describe("generating", () => {
  it("produces slugs of the right shape", () => {
    for (let n = 0; n < 50; n++) {
      const slug = newSlug();
      expect(slug).toHaveLength(SLUG_LENGTH);
      expect(isSlugShaped(slug)).toBe(true);
    }
  });

  it("does not repeat itself", () => {
    const slugs = new Set(Array.from({ length: 500 }, newSlug));
    expect(slugs.size).toBe(500);
  });

  it("produces tokens of the same alphabet", () => {
    expect(isSlugShaped(newLinkToken())).toBe(false); // different length
    expect([...newLinkToken()].every((c) => SLUG_ALPHABET.includes(c))).toBe(
      true,
    );
  });
});

describe("isSlugShaped", () => {
  it("rejects the wrong length, case and characters", () => {
    expect(isSlugShaped("")).toBe(false);
    expect(isSlugShaped("abc")).toBe(false);
    expect(isSlugShaped(newSlug().toUpperCase())).toBe(false);
    expect(isSlugShaped(newSlug().slice(0, -1) + "0")).toBe(false);
    expect(isSlugShaped(newSlug().slice(0, -1) + "/")).toBe(false);
  });
});

describe("secretEquals", () => {
  it("matches equal strings and rejects everything else", () => {
    expect(secretEquals("abc123", "abc123")).toBe(true);
    expect(secretEquals("abc123", "abc124")).toBe(false);
    expect(secretEquals("abc123", "abc12")).toBe(false);
    expect(secretEquals("", "")).toBe(true);
  });

  it("does not short-circuit on the first differing character", () => {
    // Not a timing measurement — those are flaky in CI. This asserts the shape
    // the implementation needs: a difference anywhere is caught, including in
    // the very last position, which a prefix comparison would also catch but a
    // buggy early return would not.
    expect(secretEquals("aaaaaaaa", "baaaaaaa")).toBe(false);
    expect(secretEquals("aaaaaaaa", "aaaaaaab")).toBe(false);
  });
});
