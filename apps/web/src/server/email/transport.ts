import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { emailLog } from "@/db/schema";

import type { Message } from "./messages";

/**
 * The one way this app sends an email.
 *
 * Every send is written to `email_log` before it is attempted and updated
 * after, so "did they get it?" has an answer that does not depend on asking
 * Resend. Sign-in links go through here too — Slice 4 posted to Resend
 * directly and logged nothing, which meant the one email the app already sent
 * was the one email nobody could account for.
 *
 * `api.resend.com` is refused by this container's network policy, exactly as
 * Cloudflare's and Clerk's domains are. So there are two transports: the real
 * one, and a console one that prints the message. The console transport is not
 * a stub that pretends to succeed — it is how the flow is exercised here, and
 * it writes the same `email_log` rows the real one does.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
/** Resend's own ceiling is 40MB; stay well under it, encoded size included. */
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export interface Attachment {
  filename: string;
  content: Uint8Array;
}

export interface SendRequest {
  to: string;
  message: Message;
  attachments?: Attachment[];
  /** Links the log row to what caused it. */
  submissionId?: string;
  /** Where a reply should go, when it is not the sending domain. */
  replyTo?: string;
}

export type SendOutcome =
  | {
      ok: true;
      logId: string;
      providerId: string | null;
      delivered: "sent" | "logged";
    }
  | { ok: false; logId: string; error: string };

export function canSendEmail(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function fromAddress(): string {
  return process.env.EMAIL_FROM ?? "Formcraft <onboarding@resend.dev>";
}

/**
 * Sends one email, and records it either way.
 *
 * Never throws. A failed notification must not take down the thing that
 * triggered it — a submission is accepted whether or not the owner's mail
 * server is reachable, and the log row is what says which happened.
 */
export async function sendEmail(request: SendRequest): Promise<SendOutcome> {
  const logId = nanoid();

  await db.insert(emailLog).values({
    id: logId,
    to: request.to,
    subject: request.message.subject,
    status: "queued",
    submissionId: request.submissionId ?? null,
  });

  const oversized = (request.attachments ?? []).find(
    (attachment) => attachment.content.byteLength > MAX_ATTACHMENT_BYTES,
  );

  if (oversized) {
    // Caught before the request rather than after a rejection, so the log says
    // something more useful than "413".
    return fail(
      logId,
      `attachment ${oversized.filename} is ${Math.round(oversized.content.byteLength / 1_000_000)}MB, over the limit`,
    );
  }

  if (!canSendEmail()) {
    // Printed rather than sent. Marked distinctly so a log full of these is
    // never mistaken for a log full of delivered mail.
    console.log(
      [
        "",
        "  ── email (not sent: no RESEND_API_KEY) ──",
        `  to:      ${request.to}`,
        `  subject: ${request.message.subject}`,
        ...(request.attachments ?? []).map(
          (a) => `  attach:  ${a.filename} (${a.content.byteLength} bytes)`,
        ),
        "",
        request.message.text.replace(/^/gm, "  "),
        "  ────────────────────────────────────────",
        "",
      ].join("\n"),
    );

    await db
      .update(emailLog)
      .set({ status: "logged", updatedAt: new Date() })
      .where(eq(emailLog.id, logId));

    return { ok: true, logId, providerId: null, delivered: "logged" };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [request.to],
        subject: request.message.subject,
        text: request.message.text,
        html: request.message.html,
        ...(request.replyTo ? { reply_to: request.replyTo } : {}),
        ...(request.attachments?.length
          ? {
              attachments: request.attachments.map((attachment) => ({
                filename: attachment.filename,
                content: Buffer.from(attachment.content).toString("base64"),
              })),
            }
          : {}),
      }),
      // A provider that stops answering must not hold a request open for ever.
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return fail(
        logId,
        `Resend refused the message: ${response.status} ${detail.slice(0, 300)}`,
      );
    }

    const body = (await response.json().catch(() => null)) as {
      id?: string;
    } | null;

    await db
      .update(emailLog)
      .set({
        status: "sent",
        providerId: body?.id ?? null,
        updatedAt: new Date(),
      })
      .where(eq(emailLog.id, logId));

    return { ok: true, logId, providerId: body?.id ?? null, delivered: "sent" };
  } catch (error) {
    return fail(
      logId,
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

async function fail(logId: string, error: string): Promise<SendOutcome> {
  await db
    .update(emailLog)
    .set({
      status: "failed",
      error: error.slice(0, 1000),
      updatedAt: new Date(),
    })
    .where(eq(emailLog.id, logId));

  // Logged rather than thrown: see the note on `sendEmail`.
  console.error(`email ${logId} failed: ${error}`);

  return { ok: false, logId, error };
}
