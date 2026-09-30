import { type Browser, chromium } from "playwright";

/**
 * One headless Chromium, reused.
 *
 * Launching a browser costs about a second and a hundred megabytes. Doing it
 * per request would make a PDF download feel broken and let a handful of
 * concurrent downloads exhaust the box, so the instance is a module singleton.
 *
 * The launch is behind a promise rather than a boolean: two requests arriving
 * together must await the *same* launch, not start two browsers and leak one.
 * This is the same reasoning as the single-statement rate limiter — a
 * read-then-write check races.
 */

let launching: Promise<Browser> | undefined;

/**
 * Where the Chromium binary is.
 *
 * Playwright normally resolves this itself from a browser it downloaded at the
 * revision it expects. This environment ships Chromium separately and pins it,
 * so the revision Playwright wants and the one present need not agree — and
 * when they disagree, Playwright's own resolution fails rather than falling
 * back. An explicit path is the supported way round it.
 */
function executablePath(): string | undefined {
  return process.env.CHROMIUM_EXECUTABLE_PATH || undefined;
}

export async function getBrowser(): Promise<Browser> {
  const existing = launching;
  if (existing) {
    const browser = await existing;
    // A browser that died — OOM-killed, or the container was suspended —
    // stays in the variable looking healthy. Check before handing it out.
    if (browser.isConnected()) return browser;
    launching = undefined;
  }

  launching ??= chromium.launch({
    executablePath: executablePath(),
    args: [
      // No sandbox: this runs in a container that is itself the boundary, and
      // the Chromium sandbox needs privileges a container does not grant.
      "--no-sandbox",
      "--disable-dev-shm-usage",
      // Deterministic rendering matters more than speed here: a PDF that
      // differs between runs is not a pixel-accurate record of anything.
      "--disable-gpu",
      "--font-render-hinting=none",
    ],
  });

  try {
    return await launching;
  } catch (error) {
    // Otherwise every later call awaits the same rejected promise and the
    // process can never recover.
    launching = undefined;
    throw error;
  }
}

/** Shuts the browser down. For tests and for a graceful exit. */
export async function closeBrowser(): Promise<void> {
  const pending = launching;
  launching = undefined;
  if (!pending) return;

  try {
    const browser = await pending;
    await browser.close();
  } catch {
    // Already gone, or never started. Either way there is nothing to close.
  }
}
