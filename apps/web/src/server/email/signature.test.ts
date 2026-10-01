import { describe, expect, it } from "vitest";

import {
  TOLERANCE_SECONDS,
  signWebhook,
  svixHeaders,
  verifyWebhook,
} from "./signature";

const SECRET = `whsec_${Buffer.from("a-test-signing-key").toString("base64")}`;
const ID = "msg_2b3c4d5e";
const BODY = JSON.stringify({ type: "email.bounced", data: { email_id: "x" } });

function headersFor(timestamp: number, body = BODY, secret = SECRET) {
  return {
    id: ID,
    timestamp: String(timestamp),
    signature: signWebhook({ secret, id: ID, timestamp, body }),
  };
}

describe("verifyWebhook", () => {
  const now = 1_800_000_000_000;
  const sentAt = Math.floor(now / 1000);

  it("accepts a genuine signature", () => {
    expect(
      verifyWebhook({
        secret: SECRET,
        headers: headersFor(sentAt),
        body: BODY,
        now,
      }),
    ).toEqual({ ok: true });
  });

  it("refuses a tampered body", () => {
    // The whole point: the body is what carries "this address bounced".
    const tampered = JSON.stringify({
      type: "email.bounced",
      data: { email_id: "y" },
    });

    expect(
      verifyWebhook({
        secret: SECRET,
        headers: headersFor(sentAt),
        body: tampered,
        now,
      }),
    ).toEqual({ ok: false, reason: "no-match" });
  });

  it("refuses a signature made with a different secret", () => {
    const other = `whsec_${Buffer.from("a-different-key").toString("base64")}`;

    expect(
      verifyWebhook({
        secret: SECRET,
        headers: headersFor(sentAt, BODY, other),
        body: BODY,
        now,
      }),
    ).toEqual({ ok: false, reason: "no-match" });
  });

  it("refuses a replay from outside the tolerance window", () => {
    const old = sentAt - TOLERANCE_SECONDS - 1;

    expect(
      verifyWebhook({
        secret: SECRET,
        headers: headersFor(old),
        body: BODY,
        now,
      }),
    ).toEqual({ ok: false, reason: "stale" });
  });

  it("accepts one just inside the window", () => {
    const recent = sentAt - TOLERANCE_SECONDS + 5;

    expect(
      verifyWebhook({
        secret: SECRET,
        headers: headersFor(recent),
        body: BODY,
        now,
      }),
    ).toEqual({ ok: true });
  });

  it("refuses a timestamp from the future", () => {
    // Not a thing a real sender produces, and it would otherwise extend the
    // replay window indefinitely.
    const ahead = sentAt + TOLERANCE_SECONDS + 1;

    expect(
      verifyWebhook({
        secret: SECRET,
        headers: headersFor(ahead),
        body: BODY,
        now,
      }),
    ).toEqual({ ok: false, reason: "stale" });
  });

  it("refuses when any header is missing", () => {
    const full = headersFor(sentAt);

    for (const key of ["id", "timestamp", "signature"] as const) {
      expect(
        verifyWebhook({
          secret: SECRET,
          headers: { ...full, [key]: null },
          body: BODY,
          now,
        }),
        key,
      ).toEqual({ ok: false, reason: "missing-headers" });
    }
  });

  it("refuses with no secret configured", () => {
    // An endpoint that accepts everything is worse than one that accepts
    // nothing, because it looks like it is working.
    expect(
      verifyWebhook({
        secret: undefined,
        headers: headersFor(sentAt),
        body: BODY,
        now,
      }),
    ).toEqual({ ok: false, reason: "no-secret" });
  });

  it("refuses a non-numeric timestamp", () => {
    expect(
      verifyWebhook({
        secret: SECRET,
        headers: { ...headersFor(sentAt), timestamp: "not-a-number" },
        body: BODY,
        now,
      }),
    ).toEqual({ ok: false, reason: "bad-timestamp" });
  });

  it("accepts when one of several signatures matches", () => {
    // Several are sent while a secret is being rotated.
    const good = signWebhook({
      secret: SECRET,
      id: ID,
      timestamp: sentAt,
      body: BODY,
    });

    expect(
      verifyWebhook({
        secret: SECRET,
        headers: {
          id: ID,
          timestamp: String(sentAt),
          signature: `v1,AAAA ${good} v1,BBBB`,
        },
        body: BODY,
        now,
      }),
    ).toEqual({ ok: true });
  });

  it("ignores signature versions it does not understand", () => {
    const good = signWebhook({
      secret: SECRET,
      id: ID,
      timestamp: sentAt,
      body: BODY,
    });

    expect(
      verifyWebhook({
        secret: SECRET,
        headers: {
          id: ID,
          timestamp: String(sentAt),
          signature: `v2,something ${good}`,
        },
        body: BODY,
        now,
      }),
    ).toEqual({ ok: true });

    expect(
      verifyWebhook({
        secret: SECRET,
        headers: {
          id: ID,
          timestamp: String(sentAt),
          signature: "v2,something",
        },
        body: BODY,
        now,
      }),
    ).toEqual({ ok: false, reason: "no-match" });
  });

  it("works whether the secret carries the whsec_ prefix or not", () => {
    const bare = SECRET.replace(/^whsec_/, "");

    expect(
      verifyWebhook({
        secret: bare,
        headers: headersFor(sentAt),
        body: BODY,
        now,
      }),
    ).toEqual({ ok: true });
  });
});

describe("svixHeaders", () => {
  it("reads the svix- spelling", () => {
    const headers = new Headers({
      "svix-id": "a",
      "svix-timestamp": "1",
      "svix-signature": "v1,x",
    });

    expect(svixHeaders(headers)).toEqual({
      id: "a",
      timestamp: "1",
      signature: "v1,x",
    });
  });

  it("also reads the webhook- spelling", () => {
    // The standardised names; Svix sends both and may drop the old ones.
    const headers = new Headers({
      "webhook-id": "a",
      "webhook-timestamp": "1",
      "webhook-signature": "v1,x",
    });

    expect(svixHeaders(headers)).toEqual({
      id: "a",
      timestamp: "1",
      signature: "v1,x",
    });
  });

  it("reports missing headers as null", () => {
    expect(svixHeaders(new Headers())).toEqual({
      id: null,
      timestamp: null,
      signature: null,
    });
  });
});
