import { answersSchema, validateAnswers } from "@formcraft/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { after, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { submissions } from "@/db/schema";

import { notifyOwnerOfSubmission } from "@/server/email/notify";
import { claimUse, openLink } from "@/server/publish/queries";
import { clientIp, hit } from "@/server/publish/rate-limit";
import { verifyTurnstile } from "@/server/publish/turnstile";

/**
 * Accepting a filled-in form.
 *
 * The one endpoint in this app that anybody on the internet can reach, so it is
 * written defensively throughout:
 *
 *   - **Rate limited** before anything expensive happens (rule 6).
 *   - **Turnstile** verified when configured (rule 6).
 *   - **Re-validated** against the version's own document, never against
 *     anything the client says about itself (rule 5).
 *   - **Idempotent**, so a retry on a flaky connection does not duplicate a
 *     submission.
 *
 * A route handler rather than a server action because it takes an idempotency
 * key and returns a body the client reads on retry — a shape server actions
 * make awkward.
 */

const bodySchema = z.object({
  answers: answersSchema,
  /** Client-generated, stable across retries of the same submission. */
  idempotencyKey: z.string().min(8).max(100),
  /** Turnstile response, when the widget is configured. */
  turnstileToken: z.string().max(4000).optional(),
  /** Second secret for a token-protected link. */
  token: z.string().max(100).optional(),
});

/** One message for every reason a link won't take a submission. */
const LINK_CLOSED =
  "This form is no longer accepting responses. Ask whoever sent you the link.";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await params;
  const ip = clientIp(request.headers);

  // First, before the database is asked anything at all. An unauthenticated
  // endpoint that does work before deciding whether it should is a denial of
  // service with extra steps.
  const limit = await hit("submit", `${ip}:${slug}`);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many submissions. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Malformed request." },
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const lookup = await openLink(slug, body.token);
  if (!lookup.ok) {
    // Deliberately one message and one status for every refusal. Telling a
    // stranger that a slug exists but has expired, as against never having
    // existed, hands them an oracle they have no business having.
    return NextResponse.json({ error: LINK_CLOSED }, { status: 404 });
  }

  const { link } = lookup;

  const turnstile = await verifyTurnstile(body.turnstileToken, ip);
  if (!turnstile.ok) {
    return NextResponse.json(
      { error: "Could not confirm you are human. Please try again." },
      { status: 400 },
    );
  }

  // Rule 5. The client validated these to be helpful; this is the check that
  // counts, and it runs against the immutable document the link points at
  // rather than anything the request claims about the form.
  const result = validateAnswers(link.document, body.answers);
  if (!result.ok) {
    return NextResponse.json(
      { error: "Some answers need fixing.", fieldErrors: result.errors },
      { status: 422 },
    );
  }

  // Namespaced by link: two people filling different forms cannot collide on a
  // key, and a key from one link can never resolve a submission on another.
  const idempotencyKey = `${link.linkId}:${body.idempotencyKey}`;

  const existing = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.idempotencyKey, idempotencyKey))
    .limit(1);

  if (existing[0]) {
    // The retry path: the first attempt landed and the response was lost. Say
    // it worked, because it did, and do not take a second use off the link.
    return NextResponse.json(
      { id: existing[0].id, duplicate: true },
      { status: 200 },
    );
  }

  // Claimed after validation so a rejected submission does not burn a use, and
  // before the insert so a one-use link cannot take two.
  if (!(await claimUse(link.linkId))) {
    return NextResponse.json({ error: LINK_CLOSED }, { status: 404 });
  }

  const id = nanoid();

  const inserted = await db
    .insert(submissions)
    .values({
      id,
      formVersionId: link.formVersionId,
      linkId: link.linkId,
      // The pruned set, not the request's: answers to hidden fields and keys
      // that are not questions in this form never reach storage.
      answers: result.answers,
      idempotencyKey,
      ip: ip === "unknown" ? null : ip,
      userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
    })
    // Two identical requests in flight at once: the loser takes the same path
    // as a retry rather than erroring.
    .onConflictDoNothing({ target: submissions.idempotencyKey })
    .returning({ id: submissions.id });

  if (!inserted[0]) {
    const [raced] = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(eq(submissions.idempotencyKey, idempotencyKey))
      .limit(1);

    return NextResponse.json(
      { id: raced?.id ?? null, duplicate: true },
      { status: 200 },
    );
  }

  // After the response, never before it. Notifying the owner means rendering a
  // PDF, which means launching Chromium — and Slice 6's rule is that the one
  // endpoint strangers can reach never waits on a browser. The person filling
  // the form sees "thank you" immediately; the email follows.
  after(() => notifyOwnerOfSubmission(id));

  return NextResponse.json({ id, duplicate: false }, { status: 201 });
}
