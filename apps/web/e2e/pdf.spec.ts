import { PAGE_HEIGHT, PAGE_WIDTH } from "@formcraft/schema";
import { expect, test } from "@playwright/test";

import { documentForSlug } from "./db";
import { pdfPageBox, renderToken, seed } from "./helpers";

/**
 * Slice 6's promise: filled values appear exactly where the designer put the
 * fields. That is architecture rule 2, and it is the one thing in this app
 * that cannot be checked by reading the code.
 */

test.describe("the rendered PDF", () => {
  test("is A4 at 96dpi, with one page per document page", async ({
    request,
  }) => {
    const response = await request.get(
      `/api/submissions/${seed().submissionId}/pdf`,
    );
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/pdf");

    const box = pdfPageBox(Buffer.from(await response.body()));
    expect(box, "the PDF should declare a page box").toBeTruthy();

    // 794px at 96dpi is 595.5pt; 1123px is 842.25pt. Chromium quantises the
    // sheet by about half a point whatever unit it is given, which is a
    // hairline of white — with `scale: 1` the content itself is never
    // stretched, and placement is asserted separately below. Anything beyond
    // a point would mean real scaling.
    expect(Math.abs(box!.width - (PAGE_WIDTH / 96) * 72)).toBeLessThan(1);
    expect(Math.abs(box!.height - (PAGE_HEIGHT / 96) * 72)).toBeLessThan(1);

    const document = await documentForSlug(seed().slug);
    expect(box!.pages).toBe(document.pages.length);
  });

  test("is cached after the first render", async ({ request }) => {
    // Rendering launches a browser. Caching is safe only because a version is
    // immutable — rule 4 paying for itself.
    //
    // Two warm-ups, not one: the first compiles the route (the dev server
    // builds on demand) and the second renders and stores the PDF. Only the
    // third is measuring what this test claims to measure.
    await request.get(`/api/submissions/${seed().submissionId}/pdf`);
    const first = await request.get(
      `/api/submissions/${seed().submissionId}/pdf`,
    );
    expect(first.status()).toBe(200);

    const started = Date.now();
    const second = await request.get(
      `/api/submissions/${seed().submissionId}/pdf`,
    );
    const elapsed = Date.now() - started;

    expect(second.status()).toBe(200);
    expect(
      elapsed,
      "a cached PDF should be served from storage, not re-rendered",
    ).toBeLessThan(900);
  });

  test("downloads under a filename derived from the form", async ({
    request,
  }) => {
    const response = await request.get(
      `/api/submissions/${seed().submissionId}/pdf`,
    );
    const disposition = response.headers()["content-disposition"] ?? "";

    expect(disposition).toContain("attachment");
    expect(disposition).toMatch(/filename="[^"]*\d{4}-\d{2}-\d{2}\.pdf"/);
  });
});

test.describe("the page the worker photographs", () => {
  test("draws every element at its exact document coordinates (rule 2)", async ({
    page,
  }) => {
    const secret = process.env.AUTH_SECRET;
    test.skip(!secret, "needs AUTH_SECRET to mint a render token");

    const token = renderToken(seed().submissionId, secret!);
    const response = await page.goto(
      `/internal/render/${seed().submissionId}?token=${encodeURIComponent(token)}`,
    );
    expect(response?.status()).toBe(200);

    await page.waitForSelector("#render-ready", { state: "attached" });

    const drawn = await page.evaluate(() => {
      const out: Record<
        string,
        { x: number; y: number; w: number; h: number }
      > = {};

      for (const element of document.querySelectorAll("[data-element-id]")) {
        const box = element.getBoundingClientRect();
        const surface = element
          .closest("[data-page-id]")!
          .getBoundingClientRect();

        out[element.getAttribute("data-element-id")!] = {
          x: Math.round(box.left - surface.left),
          y: Math.round(box.top - surface.top),
          w: Math.round(box.width),
          h: Math.round(box.height),
        };
      }

      return out;
    });

    const { documentForSlug } = await import("./db");
    const published = await documentForSlug(seed().slug);

    const drifted: string[] = [];

    for (const element of published.pages.flatMap((p) => p.elements)) {
      const placed = drawn[element.id];
      if (!placed) continue; // conditionally hidden, asserted elsewhere

      if (element.rotation !== 0) {
        // A rotated element's axis-aligned bounding rect is legitimately
        // larger than its w/h, so compare where its centre landed.
        const dx = Math.abs(
          element.x + element.w / 2 - (placed.x + placed.w / 2),
        );
        const dy = Math.abs(
          element.y + element.h / 2 - (placed.y + placed.h / 2),
        );
        if (dx > 1 || dy > 1) {
          drifted.push(`${element.id} (rotated ${element.rotation}°)`);
        }
        continue;
      }

      if (
        placed.x !== element.x ||
        placed.y !== element.y ||
        placed.w !== element.w ||
        placed.h !== element.h
      ) {
        drifted.push(
          `${element.id}: document ${element.x},${element.y} ${element.w}x${element.h} → drawn ${placed.x},${placed.y} ${placed.w}x${placed.h}`,
        );
      }
    }

    expect(
      drifted,
      "no element may drift from its document coordinates",
    ).toEqual([]);
  });

  test("leaves out a field a condition hid", async ({ page }) => {
    const secret = process.env.AUTH_SECRET;
    test.skip(!secret, "needs AUTH_SECRET to mint a render token");

    const document = await documentForSlug(seed().slug);
    const conditional = document.pages
      .flatMap((p) => p.elements)
      .find((element) => element.conditional)!;

    const token = renderToken(seed().submissionId, secret!);
    await page.goto(
      `/internal/render/${seed().submissionId}?token=${encodeURIComponent(token)}`,
    );
    await page.waitForSelector("#render-ready", { state: "attached" });

    // It was never asked, so an empty box beside it would claim it went
    // unanswered.
    await expect(
      page.locator(`[data-element-id="${conditional.id}"]`),
    ).toHaveCount(0);
  });
});

test.describe("the render route is shut", () => {
  test("refuses a missing, forged or expired token", async ({ request }) => {
    for (const [what, query] of [
      ["no token", ""],
      ["a forged token", `?token=${Date.now() + 60_000}.deadbeef`],
      ["an expired token", "?token=1000000000000.deadbeef"],
    ] as const) {
      const response = await request.get(
        `/internal/render/${seed().submissionId}${query}`,
        { failOnStatusCode: false },
      );

      expect(response.status(), what).toBe(404);
    }
  });

  test("refuses a token minted for a different submission", async ({
    request,
  }) => {
    const secret = process.env.AUTH_SECRET;
    test.skip(!secret, "needs AUTH_SECRET to mint a render token");

    // The reason the token is per-submission rather than one shared secret: a
    // leaked URL must not become a key to every response.
    const token = renderToken("some-other-submission", secret!);

    const response = await request.get(
      `/internal/render/${seed().submissionId}?token=${encodeURIComponent(token)}`,
      { failOnStatusCode: false },
    );

    expect(response.status()).toBe(404);
  });
});
