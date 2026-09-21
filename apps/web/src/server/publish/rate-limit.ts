import { lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { rateLimits } from "@/db/schema";

/**
 * Fixed-window rate limiting, in Postgres.
 *
 * Architecture rule 6. A public fill page is reachable by anyone with the URL,
 * so every write it can cause needs a ceiling.
 *
 * Fixed windows rather than a sliding log: a sliding window needs a row per
 * request, and the thing being defended against is somebody making a great many
 * requests. A fixed window admits up to 2x the limit across a boundary, which
 * for "stop a script filling this form ten thousand times" is a rounding error
 * against the cost of storing every attempt.
 *
 * The whole check is one statement. Read-then-write would race two concurrent
 * submits straight past the limit, which is precisely the case that matters.
 */

export interface Limit {
  /** How many are allowed in a window. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/** The ceilings, in one place so they can be read as a policy. */
export const LIMITS = {
  /** Filling a form. Generous: a real person retrying is not an attack. */
  submit: { max: 20, windowSeconds: 60 * 60 },
  /** Loading a fill page. Guards against slug enumeration by one source. */
  view: { max: 120, windowSeconds: 60 * 60 },
  /** Uploading a file answer. */
  upload: { max: 40, windowSeconds: 60 * 60 },
} as const satisfies Record<string, Limit>;

export type Bucket = keyof typeof LIMITS;

export interface RateLimitResult {
  ok: boolean;
  /** How many remain in this window. */
  remaining: number;
  /** Seconds until the window resets — becomes the `Retry-After` header. */
  retryAfter: number;
}

/**
 * Counts one hit against a bucket, and says whether it is allowed.
 *
 * `subject` is whatever is being limited: an IP, a link id, or both. It is
 * hashed into the key by the caller's choice of string, never logged here.
 */
export async function hit(
  bucket: Bucket,
  subject: string,
  override?: Limit,
): Promise<RateLimitResult> {
  const limit: Limit = override ?? LIMITS[bucket];
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % limit.windowSeconds);
  const resetsAt = windowStart + limit.windowSeconds;
  const key = `${bucket}:${subject}:${windowStart}`;

  // One statement, so two simultaneous requests cannot both read "19 used" and
  // both be allowed. The insert wins the race or the update does; either way
  // the returned count is this request's own position in the window.
  const [row] = await db
    .insert(rateLimits)
    .values({
      key,
      count: 1,
      expiresAt: new Date(resetsAt * 1000),
    })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  const count = row?.count ?? 1;

  return {
    ok: count <= limit.max,
    remaining: Math.max(0, limit.max - count),
    retryAfter: Math.max(1, resetsAt - now),
  };
}

/**
 * Deletes windows that have passed.
 *
 * Called opportunistically rather than on a schedule: there is no cron in this
 * app, and a table of expired counters is only a housekeeping problem, never a
 * correctness one — an expired row is never read, because the window is part of
 * the key.
 */
export async function sweepExpired(): Promise<void> {
  await db.delete(rateLimits).where(lt(rateLimits.expiresAt, new Date()));
}

/**
 * The client address, as far as it can be trusted.
 *
 * `x-forwarded-for` is caller-controlled unless a proxy you trust overwrites
 * it. Behind Vercel or a Cloudflare tunnel it is rewritten and the left-most
 * entry is real; behind nothing, it is a suggestion. Rate limiting is the one
 * place where that is acceptable — the worst case is somebody spoofing headers
 * to exhaust their *own* bucket — but it must never be used for authorization.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();

  return first || headers.get("x-real-ip") || "unknown";
}
