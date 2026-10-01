import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifying a Resend webhook.
 *
 * Resend signs webhooks with Svix. The endpoint is public by necessity — a
 * provider cannot sign in — so without this check anybody who finds the URL
 * can tell us an address bounced. That is worth something to an attacker: mark
 * an owner's address as bounced and their notifications stop.
 *
 * Written out rather than pulling in the `svix` package, which is not in the
 * stack table: the scheme is one HMAC and is worth having under test either
 * way. The format is Svix's:
 *
 *   svix-id:        msg_2b3c...
 *   svix-timestamp: 1700000000      (seconds)
 *   svix-signature: v1,<base64> v1,<base64>   (space-separated, several keys)
 *
 * The signed content is `${id}.${timestamp}.${rawBody}`, and the secret is
 * `whsec_<base64>` — the base64 part is the actual key, decoded before use.
 */

/** How far out of date a timestamp may be. Svix's own recommendation. */
export const TOLERANCE_SECONDS = 5 * 60;

export type VerifyFailure =
  "no-secret" | "missing-headers" | "bad-timestamp" | "stale" | "no-match";

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure };

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

/** Pulls the three headers, accepting both the `svix-` and `webhook-` spellings. */
export function svixHeaders(headers: Headers): SvixHeaders {
  return {
    id: headers.get("svix-id") ?? headers.get("webhook-id"),
    timestamp:
      headers.get("svix-timestamp") ?? headers.get("webhook-timestamp"),
    signature:
      headers.get("svix-signature") ?? headers.get("webhook-signature"),
  };
}

export function verifyWebhook({
  secret,
  headers,
  body,
  now = Date.now(),
}: {
  secret: string | undefined;
  headers: SvixHeaders;
  /** The *raw* body. Re-serialising parsed JSON changes the bytes and the signature with them. */
  body: string;
  now?: number;
}): VerifyResult {
  // Refused rather than waved through. An unverifiable webhook endpoint that
  // accepts everything is worse than one that accepts nothing, because it
  // looks like it is working.
  if (!secret) return { ok: false, reason: "no-secret" };

  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) {
    return { ok: false, reason: "missing-headers" };
  }

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return { ok: false, reason: "bad-timestamp" };

  // Both directions: an old capture must not be replayable, and a far-future
  // timestamp is not something a real sender produces.
  const driftSeconds = Math.abs(now / 1000 - sentAt);
  if (driftSeconds > TOLERANCE_SECONDS) return { ok: false, reason: "stale" };

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest();

  // Several signatures may be present while a secret is being rotated; any one
  // matching is enough.
  for (const part of signature.split(" ")) {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) continue;

    const given = Buffer.from(value, "base64");
    if (given.length !== expected.length) continue;
    if (timingSafeEqual(given, expected)) return { ok: true };
  }

  return { ok: false, reason: "no-match" };
}

/**
 * Signs a payload the way Resend would.
 *
 * Exported because the only way to test the verifier honestly is to produce a
 * genuine signature and check it is accepted — and because `api.resend.com` is
 * refused by this container's network policy, so the webhook cannot otherwise
 * be exercised end to end at all.
 */
export function signWebhook({
  secret,
  id,
  timestamp,
  body,
}: {
  secret: string;
  id: string;
  timestamp: number;
  body: string;
}): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const digest = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");

  return `v1,${digest}`;
}
