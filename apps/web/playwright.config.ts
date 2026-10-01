import { config as loadEnv } from "dotenv";

import { defineConfig, devices } from "@playwright/test";

// The app's own .env, so the tests can reach the same database and sign the
// same render tokens the server will accept. Without it, AUTH_SECRET is
// missing here and the specs that mint a token skip silently — which looks
// like a pass.
loadEnv({ path: ".env", quiet: true });

/**
 * End-to-end tests.
 *
 * These are not UI tests — the brief says not to test the UI exhaustively, and
 * they do not. They assert the architectural invariants that unit tests cannot
 * reach, because the invariants are about what several processes agree on:
 *
 *   - rule 2: the PDF lands values at the document's own coordinates
 *   - rule 4: a published version never changes under an already-sent link
 *   - rule 5: the server refuses what a tampered client sends
 *   - rule 6: slugs are unguessable, submissions are rate limited
 *
 * Every one of these was previously checked by a throwaway script, which meant
 * checking it again each time by hand. This is the same coverage, committed.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
// `localhost`, not `127.0.0.1`: Next's dev server blocks cross-origin access
// to its own HMR resources, and treats the two spellings as different origins.
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Generous: a PDF render launches a browser, and CI is slower than a laptop.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  // Serial. These share one database and one form, and the rate-limit tests
  // deliberately exhaust a counter — running them beside anything else would
  // make both flaky for reasons that have nothing to do with the code.
  workers: 1,
  fullyParallel: false,

  // A retry masks a real flake locally, where the point is to notice it.
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),

  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  // One pool for the whole run, closed once at the end. Closing it per file
  // left later files talking to a dead pool.
  globalTeardown: "./e2e/teardown.ts",

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      // Creates the form, publishes it and submits to it, once. Everything
      // else depends on this rather than seeding its own, which keeps the
      // suite to one publish instead of one per file.
      name: "setup",
      testMatch: /seed\.setup\.ts/,
      use: { ...devices["Desktop Chrome"], ...chromium() },
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: /seed\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        ...chromium(),
        // The session the setup project signed in with.
        storageState: "e2e/.auth.json",
      },
    },
  ],

  webServer: {
    // A production build, which is what these tests want for two reasons.
    //
    // `next dev` reloads the page whenever its HMR socket reconnects, and in
    // this environment that happens constantly — every navigation was being
    // undone, so a form would be created and the redirect to it immediately
    // discarded. And dev compiles each route on first request, which makes a
    // latency assertion measure the compiler rather than the handler.
    //
    // Running production means `AUTH_DEV_BYPASS` is refused, correctly, so the
    // setup project signs in the way the app really does: a `sessions` row and
    // its cookie. That exercises the real path rather than a bypass.
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: `${BASE_URL}/health`,
    // Never reuse. These tests depend on the env below — a render origin and
    // a webhook secret — and a server somebody left running on this port has
    // none of them. That failure is invisible and expensive: PDFs 500 against
    // the wrong port and every signed webhook comes back 401.
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      PORT: String(PORT),
      // The worker reaches the render page over loopback, which is the point of
      // it being loopback — unrelated to what the test browser uses.
      RENDER_ORIGIN: `http://127.0.0.1:${PORT}`,
      // Fixed, so the webhook test can sign a payload the app will accept.
      RESEND_WEBHOOK_SECRET: "whsec_ZTJlLXRlc3Qtc2lnbmluZy1rZXk=",
      // Deliberately no RESEND_API_KEY: nothing should leave the machine, and
      // `logged` is the status the tests assert on.
    },
  },
});

/**
 * Where Chromium is.
 *
 * Playwright normally resolves a browser it downloaded at the revision it
 * expects. This dev container ships one separately and pins it, so the two
 * need not agree — and when they disagree, Playwright's own resolution fails
 * rather than falling back. In CI the browser is installed the usual way and
 * this is unset.
 */
function chromium() {
  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
  return executablePath ? { launchOptions: { executablePath } } : {};
}
