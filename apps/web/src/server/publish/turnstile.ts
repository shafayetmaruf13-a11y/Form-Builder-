/**
 * Cloudflare Turnstile verification.
 *
 * Architecture rule 6 calls for Turnstile on public fill pages. The check is
 * written in full and is *off* unless both keys are set, because
 * `challenges.cloudflare.com` is unreachable from this development container —
 * the environment's network policy refuses it. Shipping a widget that cannot
 * load would make every fill page unusable here, and shipping a stub that
 * pretends to verify would be worse: it would look done.
 *
 * Setting `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` turns it on. Nothing
 * else changes — the fill page renders the widget when a site key exists, and
 * the submit route rejects a bad token whenever a secret exists.
 */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileSiteKey(): string | null {
  return process.env.TURNSTILE_SITE_KEY || null;
}

/** Whether submissions must carry a token. */
export function turnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

export interface TurnstileResult {
  ok: boolean;
  /** Cloudflare's own codes, for the log. Never shown to the person filling in. */
  errors: string[];
}

/**
 * Verifies a token with Cloudflare.
 *
 * Fails *closed*: if Turnstile is configured and its API cannot be reached, the
 * submission is refused. An anti-abuse check that disables itself the moment it
 * is under strain is not a check. The owner turns it off by removing the key,
 * deliberately, rather than by us deciding an outage means everyone is human.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, errors: [] };

  if (!token) return { ok: false, errors: ["missing-input-response"] };

  const body = new URLSearchParams({ secret, response: token });
  // Cloudflare ignores an unroutable value, and sending "unknown" is worse than
  // sending nothing.
  if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);

  try {
    const response = await fetch(VERIFY_URL, {
      method: "POST",
      body,
      // A hung anti-abuse check must not hold a request open indefinitely.
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return { ok: false, errors: [`http-${response.status}`] };
    }

    const result = (await response.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };

    return {
      ok: result.success === true,
      errors: result["error-codes"] ?? [],
    };
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.name : "unknown-error"],
    };
  }
}
