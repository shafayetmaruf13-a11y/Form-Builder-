import { expect, test as setup } from "@playwright/test";

import { closePool, documentForSlug, signInAsDevUser } from "./db";
import { answersFor, submit, waitForSave, writeSeed } from "./helpers";

/**
 * Creates the form every other spec works against.
 *
 * Driven through the real UI rather than seeded into the database: the setup
 * is itself a test that creating, designing and publishing a form works, and a
 * fixture written straight into Postgres would be a second opinion about what
 * a valid form looks like.
 *
 * Runs once. The alternative — each spec publishing its own — costs a publish
 * and a PDF render per file for no extra coverage.
 */
setup("create, publish and fill a form", async ({ page, request }) => {
  const cookie = await signInAsDevUser();
  await page.context().addCookies([
    {
      ...cookie,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  await page.goto("/forms");
  // If the session did not take, every later spec would fail somewhere far
  // less obvious than here.
  await expect(page.getByRole("heading", { name: /my forms/i })).toBeVisible();

  // Wait for hydration before clicking anything.
  //
  // `load` is not enough: the markup is there and the button looks entirely
  // normal, but React has not attached its handlers, so the click is swallowed
  // without a trace. That cost an hour of chasing a redirect that was working
  // perfectly well. A real person cannot click this fast; a test can.
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "New form" }).click();
  await page.waitForURL(/\/forms\/[^/]+$/, { timeout: 30_000 });
  const formId = page.url().split("/forms/")[1]!.split(/[?#]/)[0]!;
  expect(formId).toBeTruthy();

  // One of every element type, including a conditional field and a rotated
  // watermark — the cases the PDF and Excel specs care about.
  //
  // Retried until the sample actually lands. The builder is a client
  // component, and a click that arrives before React has attached its
  // handlers does nothing at all — silently, with the button looking entirely
  // normal. Playwright's own actionability checks cannot see that, because to
  // the DOM the button *is* ready.
  await page.waitForLoadState("networkidle");
  await expect(async () => {
    await page.getByRole("button", { name: "Load sample" }).click();
    await expect(page.locator("[data-element-id]").first()).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });

  await waitForSave(page);

  // Same reasoning, and the same failure mode: an unhydrated Publish click
  // leaves the page looking exactly as it did before.
  const dialog = page.getByRole("dialog");
  await expect(async () => {
    await page.getByRole("button", { name: /^Publish/ }).click();
    await expect(dialog).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 45_000 });

  const shareLink = dialog.getByLabel("Share link");
  await expect(shareLink).toBeVisible({ timeout: 30_000 });

  const url = await shareLink.inputValue();
  const slug = url.split("/f/")[1]!;
  expect(slug, "publishing should mint a share link").toBeTruthy();

  // The link must actually serve before anything is submitted to it.
  const linkPage = await request.get(`/f/${slug}`);
  expect(linkPage.status()).toBe(200);

  // Read the published document so answers respect its own validation rules
  // rather than guesses — the sample has a `min: 16` age and a `maxDate` date
  // of birth, and hardcoded values fail both.
  const document = await documentForSlug(slug);
  const result = await submit(request, slug, answersFor(document));

  expect(
    result.status,
    `seeding a submission failed: ${JSON.stringify(result.body)}`,
  ).toBe(201);
  expect(result.body.id).toBeTruthy();

  writeSeed({ formId, slug, submissionId: result.body.id! });

  // Handed to every other project, so none of them has to sign in again.
  await page.context().storageState({ path: "e2e/.auth.json" });

  await closePool();
});
