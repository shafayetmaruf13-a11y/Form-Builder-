import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { APIRequestContext, Page } from "@playwright/test";

/**
 * Shared machinery for the end-to-end tests.
 *
 * Deliberately thin. Anything clever here is a second implementation of the
 * thing under test, and the whole point of these tests is that they exercise
 * the real one.
 */

/**
 * Where the setup project leaves what it made.
 *
 * Resolved against the working directory, which Playwright sets to the config's
 * own folder. `import.meta.dirname` does not survive the transpile to CJS that
 * the runner does, and fails at collection with "Cannot use 'import.meta'".
 */
const SEED_FILE = join(process.cwd(), "e2e", ".seed.json");

export interface Seed {
  formId: string;
  slug: string;
  /** A submission against the published version. */
  submissionId: string;
}

export function writeSeed(seed: Seed): void {
  writeFileSync(SEED_FILE, JSON.stringify(seed, null, 2));
}

/**
 * What the setup project made.
 *
 * Read lazily and memoised, never at module scope: Playwright loads every
 * spec file before it runs the setup project, so a read at import time would
 * throw during collection and take the whole suite with it.
 */
let cached: Seed | undefined;

export function seed(): Seed {
  cached ??= JSON.parse(readFileSync(SEED_FILE, "utf8")) as Seed;
  return cached;
}

/**
 * Builds a valid answer set from a published document.
 *
 * Reads the document's own validation rules rather than hardcoding values —
 * the first version of this guessed `age: 7` against a `min: 16` and spent a
 * round being told, correctly, that it was invalid.
 */
export function answersFor(
  document: PublishedDocument,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const answers: Record<string, unknown> = {};

  for (const page of document.pages) {
    for (const element of page.elements) {
      if (!("label" in element)) continue;

      switch (element.type) {
        case "textInput":
          answers[element.id] =
            element.inputType === "email"
              ? "ada@example.com"
              : element.inputType === "url"
                ? "https://example.com"
                : element.inputType === "tel"
                  ? "+441234567890"
                  : "Ada Lovelace";
          break;
        case "textarea":
          answers[element.id] = "A longer answer.";
          break;
        case "number":
          answers[element.id] = element.validation?.min ?? 7;
          break;
        case "date":
          answers[element.id] =
            element.validation?.maxDate ??
            element.validation?.minDate ??
            "2000-06-15";
          break;
        case "checkbox":
          answers[element.id] = true;
          break;
        case "select":
        case "radioGroup":
          answers[element.id] = element.options?.[0]?.value ?? "";
          break;
        case "checkboxGroup":
          answers[element.id] = (element.options ?? [])
            .slice(0, 1)
            .map((option) => option.value);
          break;
        case "signature":
          answers[element.id] = SIGNATURE_PNG;
          break;
        case "fileUpload":
          answers[element.id] = [];
          break;
      }
    }
  }

  return { ...answers, ...overrides };
}

/** A real, if minimal, PNG — enough that an `<img>` renders it. */
export const SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export interface PublishedElement {
  id: string;
  type: string;
  label?: string;
  inputType?: string;
  rotation: number;
  x: number;
  y: number;
  w: number;
  h: number;
  options?: { id: string; label: string; value: string }[];
  conditional?: { targetId: string; operator: string; value: unknown } | null;
  validation?: {
    min?: number;
    minDate?: string;
    maxDate?: string;
  };
}

export interface PublishedDocument {
  pages: { id: string; elements: PublishedElement[] }[];
}

/** Submits answers to a public link, the way the fill page does. */
export async function submit(
  request: APIRequestContext,
  slug: string,
  answers: Record<string, unknown>,
  idempotencyKey = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
): Promise<{ status: number; body: { id?: string; error?: string } }> {
  const response = await request.post(`/api/f/${slug}/submit`, {
    data: { answers, idempotencyKey },
    failOnStatusCode: false,
  });

  return {
    status: response.status(),
    body: await response.json().catch(() => ({})),
  };
}

/**
 * Mints a render token the way the app does.
 *
 * Only used to prove the guard works — that a token for one submission does
 * not open another. The signing rule lives in `server/pdf/render-token.ts`
 * and is unit tested; this is the integration half.
 */
export function renderToken(
  submissionId: string,
  secret: string,
  ttlMs = 120_000,
): string {
  const expiresAt = Date.now() + ttlMs;
  const signature = createHmac("sha256", secret)
    .update(`${submissionId}:${expiresAt}`)
    .digest("hex");

  return `${expiresAt}.${signature}`;
}

/** Signs a Resend webhook, so the verifier can be exercised end to end. */
export function signWebhook(
  secret: string,
  id: string,
  timestampSeconds: number,
  body: string,
): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestampSeconds}.${body}`).digest("base64")}`;
}

/** The PDF's page box, in points, read straight out of the bytes. */
export function pdfPageBox(
  pdf: Buffer,
): { width: number; height: number; pages: number } | null {
  const text = pdf.toString("latin1");

  const box =
    /MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
  // From the page tree's own /Count. Counting MediaBox entries reads 2 for a
  // one-page document, because one sits on /Pages and one on /Page.
  const count = /\/Count\s+(\d+)/.exec(text);
  if (!box || !count) return null;

  return {
    width: Number(box[3]) - Number(box[1]),
    height: Number(box[4]) - Number(box[2]),
    pages: Number(count[1]),
  };
}

/**
 * Waits for the builder's autosave to report it has landed.
 *
 * Waits for a *positive* signal. The first version waited for "Saving…" to be
 * absent, which is true before a save has even been scheduled — so it returned
 * immediately and let the next step run against an unsaved document.
 */
export async function waitForSave(page: Page): Promise<void> {
  // Only the timestamped "Saved 13:04" means a save actually landed. The idle
  // state reads "All changes saved" and the pending state has no "Saving…"
  // yet, so matching either of those returns before anything has been written
  // — which is how a publish came to snapshot an empty document while the
  // canvas showed twenty-three elements.
  await page.waitForFunction(
    () => /Saved\s+\d/.test(document.body.innerText),
    undefined,
    { timeout: 30_000 },
  );
}
