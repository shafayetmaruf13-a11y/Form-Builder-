import { expect, test } from "@playwright/test";

import { documentForSlug, one, query } from "./db";
import type { PublishedDocument } from "./helpers";
import { answersFor, seed, submit } from "./helpers";

/**
 * Slice 5's invariants: the share link, the fill page, and what the server
 * does with what it is sent.
 */

test.describe("the share link", () => {
  test("is unguessable and carries no sequential id (rule 6)", () => {
    // 22 characters of a 29-symbol alphabet is ~107 bits. The URL is the
    // access control, so it has to be beyond enumeration.
    expect(seed().slug).toHaveLength(22);
    expect(seed().slug).toMatch(/^[23456789abcdefghjkmnpqrstwxyz]{22}$/);
  });

  test("refuses a slug that was never minted, with the same answer as any other refusal", async ({
    request,
  }) => {
    // Distinguishing "expired" from "never existed" tells a stranger which
    // slugs are real.
    const unknown = await request.get(`/f/${"a".repeat(22)}`);
    expect(unknown.status()).toBe(200);
    await expect(unknown.text()).resolves.toContain("isn");

    const posted = await submit(request, "a".repeat(22), {});
    expect(posted.status).toBe(404);
  });

  test("rejects a malformed slug without touching the database", async ({
    request,
  }) => {
    const result = await submit(request, "too-short", {});
    expect(result.status).toBe(404);
  });
});

test.describe("the public fill page", () => {
  test("renders real, accessible controls", async ({ page }) => {
    await page.goto(`/f/${seed().slug}`);

    // Not the builder's read-only preview: these are real form controls, and
    // every one needs a name a screen reader can announce (WCAG 2.2 AA).
    const unnamed = await page.evaluate(() => {
      const controls = [
        ...document.querySelectorAll("input, textarea, select"),
      ].filter(
        (element) =>
          (element as HTMLInputElement).type !== "hidden" &&
          (element as HTMLInputElement).type !== "file",
      );

      return controls
        .filter((element) => {
          const labels = (element as HTMLInputElement).labels;
          const aria =
            element.getAttribute("aria-label") ??
            element.getAttribute("aria-labelledby");
          const legend = element.closest("fieldset")?.querySelector("legend");
          return !(labels && labels.length > 0) && !aria && !legend;
        })
        .map((element) => element.outerHTML.slice(0, 80));
    });

    expect(unnamed, "every control needs an accessible name").toEqual([]);
  });

  test("is not indexable — the link is the access control", async ({
    page,
  }) => {
    await page.goto(`/f/${seed().slug}`);

    const robots = await page
      .locator('meta[name="robots"]')
      .getAttribute("content");

    expect(robots ?? "").toContain("noindex");
  });

  test("reports every problem at once when submitted empty", async ({
    page,
  }) => {
    await page.goto(`/f/${seed().slug}`);
    await page.getByRole("button", { name: "Submit" }).click();

    // A summary at the top, linking to each field: WCAG 3.3.1 wants an error
    // identified in text and reachable, not just a red border somewhere below
    // the fold.
    const summary = page.getByRole("alert").first();
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(/problem/i);
    await expect(summary.getByRole("link").first()).toBeVisible();
  });

  test("shows and hides a conditional field as its trigger changes", async ({
    page,
  }) => {
    await page.goto(`/f/${seed().slug}`);

    const document = await documentForSlug(seed().slug);
    const conditional = document.pages
      .flatMap((p) => p.elements)
      .find((element) => element.conditional);

    expect(
      conditional,
      "the sample form should have a conditional",
    ).toBeTruthy();
    const trigger = conditional!.conditional!.targetId;
    const wanted = String(conditional!.conditional!.value);

    const dependent = page.locator(`[data-element-id="${conditional!.id}"]`);

    // Removed from the DOM, not hidden with CSS: a display:none field is
    // still submitted by some browsers and still reachable by some screen
    // readers.
    await expect(dependent).toHaveCount(0);

    await page.locator(`#${trigger}-control`).selectOption(wanted);
    await expect(dependent).toHaveCount(1);

    const other = (
      document.pages
        .flatMap((p) => p.elements)
        .find((element) => element.id === trigger)!.options ?? []
    ).find((option) => option.value !== wanted);

    await page.locator(`#${trigger}-control`).selectOption(other!.value);
    await expect(dependent).toHaveCount(0);
  });
});

test.describe("the server re-validates everything (rule 5)", () => {
  test("refuses an empty submission", async ({ request }) => {
    const result = await submit(request, seed().slug, {});
    expect(result.status).toBe(422);
  });

  test("refuses a malformed body", async ({ request }) => {
    const response = await request.post(`/api/f/${seed().slug}/submit`, {
      data: "not json",
      headers: { "content-type": "application/json" },
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(400);
  });

  test("refuses a required field emptied in the request", async ({
    request,
  }) => {
    const document = await documentForSlug(seed().slug);
    const required = document.pages
      .flatMap((p) => p.elements)
      .find((element) => "label" in element && element.type === "textInput");

    const result = await submit(request, seed().slug, {
      ...answersFor(document),
      [required!.id]: "",
    });

    expect(result.status).toBe(422);
  });

  test("refuses a choice that is not one of the options", async ({
    request,
  }) => {
    // The page only ever offers real options, so anything else means the
    // request did not come from the page.
    const document = await documentForSlug(seed().slug);
    const select = document.pages
      .flatMap((p) => p.elements)
      .find((element) => element.type === "select");

    const result = await submit(request, seed().slug, {
      ...answersFor(document),
      [select!.id]: "smuggled-option",
    });

    expect(result.status).toBe(422);
  });

  test("refuses an oversized or non-PNG signature", async ({ request }) => {
    const document = await documentForSlug(seed().slug);
    const signature = document.pages
      .flatMap((p) => p.elements)
      .find((element) => element.type === "signature");

    const huge = await submit(request, seed().slug, {
      ...answersFor(document),
      [signature!.id]: `data:image/png;base64,${"A".repeat(300_000)}`,
    });
    expect(huge.status).toBe(422);

    const wrongType = await submit(request, seed().slug, {
      ...answersFor(document),
      [signature!.id]: "data:text/html;base64,PHNjcmlwdD4=",
    });
    expect(wrongType.status).toBe(422);
  });

  test("never stores a key that is not a question in this form", async ({
    request,
  }) => {
    // `validateAnswers` builds its result up from the document rather than
    // filtering the request down, so a tampered key cannot reach jsonb.
    const document = await documentForSlug(seed().slug);

    const result = await submit(request, seed().slug, {
      ...answersFor(document),
      el_smuggled: "should never be stored",
    });

    expect(result.status).toBe(201);

    const row = await one<{ answers: Record<string, unknown> }>(
      `select answers from submissions where id = $1`,
      [result.body.id],
    );

    expect(Object.keys(row!.answers)).not.toContain("el_smuggled");
  });

  test("drops the answer to a field a condition hid", async ({ request }) => {
    const document = await documentForSlug(seed().slug);
    const conditional = document.pages
      .flatMap((p) => p.elements)
      .find((element) => element.conditional)!;

    // The trigger is left at a value that does *not* reveal it, while an
    // answer for it is sent anyway — a stale tab, or a tampered client.
    const result = await submit(request, seed().slug, {
      ...answersFor(document),
      [conditional.id]: "typed before the condition turned",
    });

    expect(result.status).toBe(201);

    const row = await one<{ answers: Record<string, unknown> }>(
      `select answers from submissions where id = $1`,
      [result.body.id],
    );

    expect(Object.keys(row!.answers)).not.toContain(conditional.id);
  });
});

test.describe("submitting is idempotent", () => {
  test("a retried key returns the first submission rather than making a second", async ({
    request,
  }) => {
    const document = await documentForSlug(seed().slug);
    const answers = answersFor(document);
    const key = `e2e-idempotent-${Date.now()}`;

    const first = await submit(request, seed().slug, answers, key);
    expect(first.status).toBe(201);

    const retry = await submit(request, seed().slug, answers, key);
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(first.body.id);

    const rows = await query(
      `select 1 from submissions where idempotency_key like $1`,
      [`%${key}`],
    );
    expect(rows).toHaveLength(1);
  });
});

test.describe("rule 4: a published version is immutable", () => {
  test("editing the draft does not change what an already-sent link shows", async ({
    request,
  }) => {
    const before = await request.get(`/f/${seed().slug}`);
    expect(await before.text()).toContain("Full name");

    // Edited through the autosave endpoint the builder itself posts to, which
    // is what "the owner edits the form" means on the server. Driving the
    // canvas instead would be testing the properties panel — the invariant
    // here is rule 4, and the brief says not to test the UI exhaustively.
    const form = await one<{
      draft_document: PublishedDocument;
      updated_at: Date;
    }>(`select draft_document, updated_at from forms where id = $1`, [
      seed().formId,
    ]);

    const draft = form!.draft_document;
    const renamed = {
      ...draft,
      pages: draft.pages.map((page) => ({
        ...page,
        elements: page.elements.map((element) =>
          element.id === "el_name"
            ? { ...element, label: "COMPLETELY DIFFERENT LABEL" }
            : element,
        ),
      })),
    };

    const saved = await request.patch(`/api/forms/${seed().formId}`, {
      data: {
        document: renamed,
        expectedUpdatedAt: new Date(form!.updated_at).toISOString(),
      },
      failOnStatusCode: false,
    });
    expect(saved.status(), await saved.text()).toBe(200);

    // The draft really did change…
    const after = await one<{ label: string }>(
      `select e->>'label' as label
         from forms f,
              lateral jsonb_array_elements(f.draft_document->'pages'->0->'elements') e
        where f.id = $1 and e->>'id' = 'el_name'`,
      [seed().formId],
    );
    expect(after!.label).toBe("COMPLETELY DIFFERENT LABEL");

    // …and the published link did not follow it.
    const published = await request.get(`/f/${seed().slug}`);
    const html = await published.text();
    expect(html, "the published version must not follow the draft").toContain(
      "Full name",
    );
    expect(html).not.toContain("COMPLETELY DIFFERENT LABEL");
  });
});
