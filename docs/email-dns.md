# Email DNS records

**These are for you to add to your domain. Nothing in this repo touches DNS,
and nothing should be given credentials that could.** Publishing a record is a
change to the public identity of a domain, with consequences for mail you send
from it that have nothing to do with this app — it is the owner's decision and
the owner's hands.

This page is what to add and why. The exact values come from Resend, because
the DKIM key is generated per domain.

---

## Before you start

1. Add your domain in Resend: **Domains → Add Domain**.
2. Resend shows you a set of records. **Those values win over the examples
   below** — the ones here show the shape so you know what you are looking at.
3. Add them at your DNS provider, wait for propagation (minutes to a few
   hours), then press **Verify** in Resend.
4. Set `EMAIL_FROM` in the environment to an address at that domain, e.g.
   `Formcraft <forms@yourdomain.com>`.

Until the domain is verified, Resend will only deliver to the address that owns
the account. That is a Resend restriction, not one of ours.

---

## 1. SPF — who may send as you

SPF lists the servers allowed to send mail using your domain in the envelope.
Without it, receiving servers have no way to tell your mail from somebody
forging your domain, and the usual outcome is the spam folder.

|       |                                                                    |
| ----- | ------------------------------------------------------------------ |
| Type  | `TXT`                                                              |
| Name  | `send` (Resend uses a subdomain, so this is `send.yourdomain.com`) |
| Value | `v=spf1 include:amazonses.com ~all`                                |

**If you already have an SPF record on that name, merge them — do not add a
second one.** A domain with two SPF records is treated as having none, which
is worse than having neither. Merging means putting both `include:` terms in
one record:

```
v=spf1 include:amazonses.com include:_spf.google.com ~all
```

`~all` is a soft fail: mail from elsewhere is marked suspicious rather than
rejected outright. Move to `-all` once you are confident nothing else sends as
this domain.

---

## 2. DKIM — proof the message was not altered

DKIM signs each message with a private key Resend holds; the public half goes
in DNS so receivers can check the signature. This is what survives forwarding,
and it is the record that most affects whether you land in the inbox.

|       |                                                                                               |
| ----- | --------------------------------------------------------------------------------------------- |
| Type  | `TXT`                                                                                         |
| Name  | `resend._domainkey`                                                                           |
| Value | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GN...` (**take this from Resend — it is unique to your domain**) |

Two things that catch people out:

- Some DNS providers wrap long TXT values. The value must stay one string.
- Do not regenerate the key in Resend without updating DNS, or every message
  fails DKIM until you do.

---

## 3. DMARC — what to do when the first two fail

DMARC tells receivers how to treat mail that fails SPF and DKIM, and asks them
to report what they saw. Without it, SPF and DKIM are advisory.

|       |                                                     |
| ----- | --------------------------------------------------- |
| Type  | `TXT`                                               |
| Name  | `_dmarc`                                            |
| Value | `v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com` |

**Start at `p=none`.** It changes nothing about delivery and only asks for
reports, which is what you want while you find out whether anything else sends
as your domain — a help desk, a newsletter tool, an old server nobody
remembers. Read the reports for a couple of weeks, then tighten:

| Policy         | Effect                                                  |
| -------------- | ------------------------------------------------------- |
| `p=none`       | Report only. Start here.                                |
| `p=quarantine` | Failing mail goes to spam.                              |
| `p=reject`     | Failing mail is refused outright. The goal, eventually. |

Going straight to `p=reject` before you know what sends as your domain is the
reliable way to make your own invoices disappear.

---

## Checking it worked

```bash
dig +short TXT send.yourdomain.com
dig +short TXT resend._domainkey.yourdomain.com
dig +short TXT _dmarc.yourdomain.com
```

Then send yourself one. In Gmail, **Show original** reports `SPF`, `DKIM` and
`DMARC` — all three should say `PASS`.

---

## Bounce and complaint webhooks

Resend reports delivery outcomes to `/api/webhooks/resend`, which writes them
to the `email_log` table.

1. In Resend: **Webhooks → Add Endpoint**, pointing at
   `https://yourdomain.com/api/webhooks/resend`.
2. Subscribe to `email.sent`, `email.delivered`, `email.bounced`,
   `email.complained` and `email.failed`.
3. Copy the signing secret into `RESEND_WEBHOOK_SECRET`.

**Without that secret set, the endpoint rejects everything.** That is
deliberate: the endpoint is public, so anyone who found the URL could otherwise
mark an address as bounced and silently stop that person's notifications.

A complaint (`email.complained`) means somebody pressed "this is spam". Treat
it as a stop signal for that address rather than something to retry.
