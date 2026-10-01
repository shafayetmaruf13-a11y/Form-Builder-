import { expect, test } from "@playwright/test";

import { documentForSlug, one, query } from "./db";
import { answersFor, seed, signWebhook, submit } from "./helpers";

/**
 * Slice 8: email.
 *
 * `api.resend.com` is refused by the dev container's network policy, so no
 * delivery can be observed. What can be, and is what matters: that the
 * submission does not wait for the email, that the right row lands in
 * `email_log`, that the toggle stops it, and that the webhook refuses
 * forgeries.
 */

/** Matches the value `playwright.config.ts` starts the server with. */
const WEBHOOK_SECRET = "whsec_ZTJlLXRlc3Qtc2lnbmluZy1rZXk=";

/** Waits for the `after()` work to land, which is by definition not awaited. */
async function waitForLog(submissionId: string, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const row = await one<{ to: string; status: string }>(
      `select "to", status from email_log where submission_id = $1 limit 1`,
      [submissionId],
    );
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return undefined;
}

test.describe("notifying the owner", () => {
  test("does not make the submitter wait for a PDF render", async ({
    request,
  }) => {
    const document = await documentForSlug(seed().slug);

    // Warm first: the point is to measure the handler, not whatever the
    // runtime does on its very first call.
    await submit(request, seed().slug, answersFor(document));

    const started = Date.now();
    const result = await submit(request, seed().slug, answersFor(document));
    const elapsed = Date.now() - started;

    expect(result.status).toBe(201);
    // Rendering a PDF takes about a second. Slice 6's rule is that the one
    // endpoint strangers can reach never waits on a browser.
    expect(
      elapsed,
      "the response should not wait for the notification",
    ).toBeLessThan(900);
  });

  test("logs a notification addressed to the owner", async ({ request }) => {
    const document = await documentForSlug(seed().slug);
    const result = await submit(request, seed().slug, answersFor(document));
    expect(result.status).toBe(201);

    const row = await waitForLog(result.body.id!);

    expect(row, "a notification should be logged").toBeTruthy();
    expect(row!.to).toBe("dev@formcraft.local");
    // Deliberately distinct from `sent`: nothing left the machine, and a log
    // full of these must never be mistaken for delivered mail.
    expect(row!.status).toBe("logged");
  });

  test("stops when the form's toggle is off", async ({ page, request }) => {
    await page.goto(`/forms/${seed().formId}/responses`);

    const toggle = page.getByRole("checkbox", {
      name: /email me each new response/i,
    });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();

    // The action is what counts; wait for it to reach the database.
    await expect
      .poll(
        async () =>
          (
            await one<{ notify_on_submission: boolean }>(
              `select notify_on_submission from forms where id = $1`,
              [seed().formId],
            )
          )?.notify_on_submission,
      )
      .toBe(false);

    const document = await documentForSlug(seed().slug);
    const result = await submit(request, seed().slug, answersFor(document));
    expect(result.status).toBe(201);

    // Long enough that a notification would have landed if one were coming.
    await new Promise((resolve) => setTimeout(resolve, 8000));

    const rows = await query(
      `select 1 from email_log where submission_id = $1`,
      [result.body.id],
    );
    expect(rows, "no email should be sent with the toggle off").toHaveLength(0);

    await toggle.check();
    await expect
      .poll(
        async () =>
          (
            await one<{ notify_on_submission: boolean }>(
              `select notify_on_submission from forms where id = $1`,
              [seed().formId],
            )
          )?.notify_on_submission,
      )
      .toBe(true);
  });
});

test.describe("forwarding a response", () => {
  test("refuses an address the server does not believe (rule 5)", async ({
    page,
  }) => {
    await page.goto(`/forms/${seed().formId}/responses`);

    const before = await query(`select 1 from email_log`);

    await page.getByRole("button", { name: "Email" }).first().click();
    await page.locator("#email-to").fill("not-an-address");
    await page.getByRole("button", { name: "Send" }).click();

    // `type="email"` is a courtesy; this is the check that counts.
    await expect(page.getByRole("status")).toContainText(/does not look like/i);

    const after = await query(`select 1 from email_log`);
    expect(after).toHaveLength(before.length);
  });

  test("sends to a valid address and logs it", async ({ page }) => {
    await page.goto(`/forms/${seed().formId}/responses`);

    const address = `colleague-${Date.now()}@example.com`;

    await page.getByRole("button", { name: "Email" }).first().click();
    await page.locator("#email-to").fill(address);
    await page.locator("#email-note").fill("Please review.");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByRole("status")).toContainText(/log|sent/i, {
      timeout: 30_000,
    });

    const row = await one<{ status: string }>(
      `select status from email_log where "to" = $1`,
      [address],
    );
    expect(row).toBeTruthy();
  });
});

test.describe("the bounce webhook", () => {
  const providerId = `re_e2e_${Date.now()}`;

  test.beforeAll(async () => {
    await query(
      `insert into email_log (id, "to", subject, provider_id, status)
       values ($1, 'x@example.com', 'E2E probe', $2, 'sent')`,
      [`log_e2e_${Date.now()}`, providerId],
    );
  });

  async function post(
    request: Parameters<typeof submit>[0],
    {
      type,
      secret = WEBHOOK_SECRET,
      ageSeconds = 0,
      signed = true,
    }: {
      type: string;
      secret?: string;
      ageSeconds?: number;
      signed?: boolean;
    },
  ) {
    const body = JSON.stringify({ type, data: { email_id: providerId } });
    const id = "msg_e2e";
    const timestamp = Math.floor(Date.now() / 1000) - ageSeconds;

    return request.post("/api/webhooks/resend", {
      headers: {
        "content-type": "application/json",
        ...(signed
          ? {
              "svix-id": id,
              "svix-timestamp": String(timestamp),
              "svix-signature": signWebhook(secret, id, timestamp, body),
            }
          : {}),
      },
      data: body,
      failOnStatusCode: false,
    });
  }

  test("refuses unsigned, forged and replayed requests", async ({
    request,
  }) => {
    // The endpoint is public — a provider cannot sign in — so without this
    // anybody who found the URL could mark an owner's address as bounced and
    // silently stop their notifications.
    const cases = [
      ["unsigned", { type: "email.bounced", signed: false }],
      [
        "signed with the wrong key",
        { type: "email.bounced", secret: "whsec_d3Jvbmcta2V5" },
      ],
      [
        "replayed from outside the window",
        { type: "email.bounced", ageSeconds: 1800 },
      ],
    ] as const;

    for (const [what, options] of cases) {
      const response = await post(request, options);
      expect(response.status(), what).toBe(401);
    }

    const row = await one<{ status: string }>(
      `select status from email_log where provider_id = $1`,
      [providerId],
    );
    expect(row!.status, "none of those should have changed anything").toBe(
      "sent",
    );
  });

  test("accepts a genuine event and records it", async ({ request }) => {
    const response = await post(request, { type: "email.bounced" });
    expect(response.status()).toBe(200);

    const row = await one<{ status: string }>(
      `select status from email_log where provider_id = $1`,
      [providerId],
    );
    expect(row!.status).toBe("bounced");
  });

  test("never lets a late event undo a final one", async ({ request }) => {
    // Events arrive out of order; a stray `sent` after a `bounced` would make
    // the log claim an address works when it does not.
    const response = await post(request, { type: "email.sent" });
    expect(response.status()).toBe(200);

    const row = await one<{ status: string }>(
      `select status from email_log where provider_id = $1`,
      [providerId],
    );
    expect(row!.status).toBe("bounced");
  });

  test("accepts an event it does not model, rather than making it retry", async ({
    request,
  }) => {
    const response = await post(request, { type: "email.opened" });
    expect(response.status()).toBe(200);
  });
});
