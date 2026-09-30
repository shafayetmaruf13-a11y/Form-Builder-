import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Authorising the PDF worker to fetch the page it photographs.
 *
 * `/internal/render/<submissionId>` has no session, because the browser
 * fetching it is not signed in as anybody. That makes it the highest-value
 * route in the app: reachable and unauthenticated, it is an IDOR over every
 * response ever collected. Two things keep it shut — a token it must carry,
 * and the worker only ever reaching it over loopback. Neither alone is enough:
 * a token in a URL can end up in a log, and loopback stops being loopback the
 * first time somebody puts the app behind a proxy.
 *
 * The token is an HMAC over the submission id and an expiry, keyed on
 * `AUTH_SECRET`. Deliberately *not* a secret held in a module variable:
 * Next.js compiles a route handler and an RSC page into separate module
 * graphs, so a token generated at import time exists twice in one process with
 * two different values — which is exactly the bug the first version of this
 * file shipped. A derived token has no state to disagree about.
 *
 * Being per-submission and short-lived also makes a leak much less
 * interesting: a captured URL grants one response for two minutes, not every
 * response forever.
 */

/** Long enough for a cold Chromium start, short enough that a leak is stale. */
const TTL_MS = 2 * 60 * 1000;

function key(): string {
  const secret = process.env.AUTH_SECRET;

  // Refused rather than defaulted. A well-known fallback key is worse than no
  // check at all, because it looks like one.
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is required to render PDFs: it keys the token that lets the worker read /internal/render.",
    );
  }

  return secret;
}

function sign(submissionId: string, expiresAt: number): string {
  return createHmac("sha256", key())
    .update(`${submissionId}:${expiresAt}`)
    .digest("hex");
}

/** A token the worker puts in the URL. */
export function renderToken(submissionId: string): string {
  const expiresAt = Date.now() + TTL_MS;
  return `${expiresAt}.${sign(submissionId, expiresAt)}`;
}

/**
 * Whether a token authorises rendering this particular submission.
 *
 * Bound to the id, so a token for one submission cannot fetch another — which
 * a single shared secret would have allowed.
 */
export function renderTokenValid(
  submissionId: string,
  supplied: string | null,
): boolean {
  if (!supplied) return false;

  const dot = supplied.indexOf(".");
  if (dot < 1) return false;

  const expiresAt = Number(supplied.slice(0, dot));
  if (!Number.isSafeInteger(expiresAt) || expiresAt < Date.now()) return false;

  const given = Buffer.from(supplied.slice(dot + 1), "utf8");
  const expected = Buffer.from(sign(submissionId, expiresAt), "utf8");

  // `timingSafeEqual` throws on a length mismatch, which would leak the
  // length; the lengths are compared first and the answer is `false` either
  // way.
  if (given.length !== expected.length) return false;

  return timingSafeEqual(given, expected);
}

/**
 * Where the worker's browser should fetch pages from.
 *
 * Loopback by default, and from an environment variable — never from the
 * incoming request's `Host` header. A caller-controlled origin here would let
 * somebody point our own browser, carrying our own token, at a host they
 * control.
 */
export function renderOrigin(): string {
  return (
    process.env.RENDER_ORIGIN ||
    `http://127.0.0.1:${process.env.PORT || "3000"}`
  );
}
