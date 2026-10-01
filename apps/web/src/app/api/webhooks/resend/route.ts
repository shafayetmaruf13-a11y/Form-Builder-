import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { emailLog } from "@/db/schema";
import { svixHeaders, verifyWebhook } from "@/server/email/signature";

/**
 * Resend telling us what happened to a message.
 *
 * Public by necessity — a provider cannot sign in — and therefore verified on
 * every request. Without the signature check anybody who finds this URL could
 * mark an owner's address as bounced, which would quietly stop their
 * notifications: a denial of service that looks like a mail problem.
 */

/** Resend's event names, mapped onto `email_log.status`. */
const STATUS: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
};

/**
 * How final each status is.
 *
 * Events arrive out of order — `delivered` can land before `sent` — so a later
 * event only wins if it says more than what is already recorded. Otherwise a
 * stray `sent` would overwrite a `bounced` and the log would say an address
 * works when it does not.
 */
const RANK: Record<string, number> = {
  queued: 0,
  logged: 0,
  sent: 1,
  delayed: 2,
  delivered: 3,
  complained: 4,
  bounced: 5,
  failed: 5,
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  // The *raw* body: re-serialising parsed JSON changes the bytes, and the
  // signature is over the bytes.
  const body = await request.text();

  const verified = verifyWebhook({
    secret: process.env.RESEND_WEBHOOK_SECRET,
    headers: svixHeaders(request.headers),
    body,
  });

  if (!verified.ok) {
    // One status and no detail. Telling a caller *why* their forgery failed
    // is a tutorial in forging the next one.
    console.warn(`rejected Resend webhook: ${verified.reason}`);
    return NextResponse.json({ error: "Not accepted" }, { status: 401 });
  }

  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Malformed" }, { status: 400 });
  }

  const status = event.type ? STATUS[event.type] : undefined;
  const providerId = event.data?.email_id;

  // 200 for an event we do not model: Svix retries anything else, and there is
  // nothing to retry — we simply do not care about this one.
  if (!status || !providerId) return NextResponse.json({ ok: true });

  const [existing] = await db
    .select({ id: emailLog.id, status: emailLog.status })
    .from(emailLog)
    .where(eq(emailLog.providerId, providerId))
    .limit(1);

  // An unknown provider id is not an error either: it may belong to a message
  // sent by another deployment sharing the Resend account.
  if (!existing) return NextResponse.json({ ok: true });

  if ((RANK[status] ?? 0) >= (RANK[existing.status] ?? 0)) {
    await db
      .update(emailLog)
      .set({ status, updatedAt: new Date() })
      .where(eq(emailLog.id, existing.id));
  }

  return NextResponse.json({ ok: true });
}
