# Deploying Formcraft

**You run these steps.** Nothing in this repository holds cloud credentials,
and standing up a public endpoint that collects other people's form
submissions is the owner's decision, not a side effect of a build.

Written for an Oracle Cloud compute instance, because that is where this one is
going. Nothing below is Oracle-specific except §2 — any Ubuntu VM with a public
IP works the same way.

---

## The short version

On a fresh Ubuntu instance with ports 80 and 443 open:

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker "$USER" && newgrp docker

git clone -b main-ry1qm3 https://github.com/shafayetmaruf13-a11y/Form-Builder-.git
cd Form-Builder-
./deploy/bootstrap.sh you@example.com
```

That generates the secrets, works out the machine's public IP, and brings up
Postgres, the app and Caddy. When it finishes it prints the URL — something
like `https://150-230-44-12.sslip.io` — with a real certificate.

**No domain name and no DNS records.** `sslip.io` is a public resolver that
maps a hostname containing an IP straight back to that IP, which is all
Let's Encrypt needs to issue a certificate. Point a real domain at the machine
later and re-run with `--host forms.example.com`.

Everything after this is what to do when that does not just work, and the
things worth knowing before the URL reaches anybody else.

---

## What you are building

```
         internet
            │  443
   ┌────────▼──────────────────────────────────┐
   │ Compute instance (Ampere A1, arm64)       │
   │                                           │
   │  caddy ──► app ──► postgres               │
   │             │        │                    │
   │             └────────┘ compose network    │
   │             │  (PDF worker fetches its    │
   │             └───  own pages over loopback) │
   │                                           │
   │  volumes: pgdata, uploads                 │
   └───────────────────────────────────────────┘
```

One instance, four containers, nothing else to provision.

## 1. The instance

**Shape.** Ampere A1 (`VM.Standard.A1.Flex`) is in the Always Free tier and is
the right choice — note it is **arm64**, which is fine: the image installs the
distribution's Chromium, which exists for arm64, and builds natively on the
instance.

Give it **at least 2 OCPU and 8 GB**. Not the 1 GB `E2.1.Micro`: `next build`
alone will exhaust that, and a PDF render is a headless browser that the OOM
reaper will kill on that shape. The free Ampere allocation is 4 OCPU and 24 GB
in total, so you can give this one instance all of it.

**Image.** Ubuntu 22.04 or 24.04 (arm64). Oracle Linux works; the firewall
commands in §2 differ.

**Disk.** The 50 GB boot volume is plenty. Both volumes — the database and the
uploads — live on it, so read §6 before you rely on it.

## 2. Networking — the step everyone loses an hour to

**Two firewalls, and both must allow the traffic.** This is the single most
common Oracle Cloud complaint, and it presents as "I opened the ports and it
still times out".

1. **The VCN security list or NSG**, in the console: add stateful ingress for
   TCP **80** and **443** from `0.0.0.0/0`.
2. **The instance's own firewall.** Oracle's images ship with iptables rules
   that drop everything but SSH, and the console's security list says nothing
   about them.

On Ubuntu:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save      # or the rules vanish on reboot
```

On Oracle Linux:

```bash
sudo firewall-cmd --permanent --add-service=http --add-service=https
sudo firewall-cmd --reload
```

Check from your own machine, not from the instance — a NAT'd cloud instance
often cannot reach its own public address, so testing locally proves nothing:

```bash
curl -sv https://<your-ip-with-dashes>.sslip.io/health
```

## 3. Docker

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker "$USER"
newgrp docker     # or log out and back in
```

## 4. Run it

```bash
git clone -b main-ry1qm3 https://github.com/shafayetmaruf13-a11y/Form-Builder-.git
cd Form-Builder-
./deploy/bootstrap.sh you@example.com
```

The script writes `.env` — secrets generated, `0600`, gitignored — and then
runs `docker compose -f docker-compose.server.yml up -d --build`. Re-running it
keeps the existing secrets rather than rotating them, because changing
`AUTH_SECRET` signs everybody out and invalidates sign-in links in flight.

Useful flags:

| Flag                       | For                                                  |
| -------------------------- | ---------------------------------------------------- |
| `--host forms.example.com` | once a real domain points at the machine             |
| `--env-only`               | write `.env` and stop, to inspect it before starting |

The first build takes a while: Chromium is a large package and `next build` is
not quick. Watch it with:

```bash
docker compose -f docker-compose.server.yml logs -f app
```

**The build needs outbound access to `fonts.googleapis.com`.** `next/font`
downloads the four families at build time and serves them from your own origin
afterwards. If that is blocked the build fails, which is the good outcome — the
bad one is a build that quietly falls back and makes every PDF stop matching
its design.

## 5. Signing in

With `RESEND_API_KEY` unset nothing is emailed: the sign-in link is written to
the container log instead, and recorded in `email_log` with status `logged`
rather than `sent`. That is enough to get in.

1. Open `https://<host>/sign-in` and enter the address you passed to
   `bootstrap.sh`.
2. Read the link out of the log and open it:

```bash
docker compose -f docker-compose.server.yml logs app | grep -A2 'Sign-in link'
```

That address is already the workspace owner, because the migration step made it
one. **Ownership is decided on the first migration only** — a later change to
`FORMCRAFT_OWNER_EMAIL` is reported and ignored, since ownership moves by
transfer in the members dashboard and nowhere else.

If you leave `FORMCRAFT_OWNER_EMAIL` unset, the workspace is created ownerless
and the first address to sign in claims it. Fine if that is certainly you; a
giveaway if the URL reaches anybody else first.

Then set up real mail with `RESEND_API_KEY` and `EMAIL_FROM`, and add the DNS
records in [email-dns.md](./email-dns.md) — which are yours to add, not this
app's.

## 6. Backups — the thing that will bite you

This shape puts **the database and the uploads on the instance's disk**, in two
Docker volumes. `docker compose down -v` deletes both, and so does losing the
instance. That is the explicit trade-off of not running a managed database; see
the end of this page for the other shape.

```bash
# Database
docker compose -f docker-compose.server.yml exec -T postgres \
  pg_dump -U formcraft formcraft | gzip > "db-$(date +%F).sql.gz"

# Uploaded logos and file answers
docker run --rm -v formcraft_uploads:/data -v "$PWD:/backup" alpine \
  tar czf "/backup/uploads-$(date +%F).tar.gz" -C /data .
```

Put those two in a cron job and copy the output somewhere off the instance.
Architecture rule 4 cuts both ways: a lost `form_versions` row takes every
submission that references it, because a submission is only meaningful against
the exact version it was filled against.

**Memory.** `mem_limit: 2g` on the app container stops a runaway render taking
the host down with it. If PDF downloads start failing under load, that is the
first thing to look at, and `docker stats` will tell you before your users do.

## 7. Updating

```bash
git pull
docker compose -f docker-compose.server.yml up -d --build
```

Migrations run automatically before the app starts, and are idempotent — CI
proves that by applying them twice on every push.

## Before you share a link

- [ ] You have signed in and the members dashboard shows you as owner
- [ ] `https://` works from a machine that is not the instance
- [ ] **Turnstile keys are set** — architecture rule 6 wants them, and a public
      fill page without them has only rate limiting between it and a patient bot
- [ ] Both backups above are running on a schedule, and restoring one has been
      tried at least once
- [ ] SPF, DKIM and DMARC are published if you are sending mail
- [ ] `docker compose -f docker-compose.server.yml exec postgres env | grep PASSWORD`
      is not the example value (it is generated, but check)

## The other shape: a managed database

`docker-compose.prod.yml` is the same app with **no Postgres container** — it
expects `DATABASE_URL` to point at a managed service, so backups, restores,
upgrades and disk growth are somebody else's job. Prefer it once the
submissions in the database start mattering.

Nothing in the application changes. Drizzle's Postgres dialect, `jsonb`, the
partial unique index enforcing one owner, and the single-statement upserts the
rate limiter and idempotency depend on all work exactly as they do locally.
Only `DATABASE_URL` moves.

Two things to check before you choose it:

- **OCI Database with PostgreSQL is not part of the Always Free tier** as far as
  I can tell — Always Free covers compute, block storage and Autonomous
  Database, which is Oracle's own engine, not Postgres. Read the cost estimate
  in the console before you create one. If this is a development environment you
  look at rather than a service other people depend on, the all-in-one shape
  above is free and one command.
- Put it in the **same VCN** on a private subnet, allow ingress on 5432 from
  the compute instance's subnet CIDR only, and use `?sslmode=require` in the
  URL — `verify-full` with `sslrootcert=` is better still, because it catches a
  misdirected connection rather than merely encrypting one.

## Not covered here

Running the end-to-end suite against this deployment. It creates and deletes
forms, submissions and sessions freely, and exhausts rate-limit counters on
purpose. Point it at a disposable database, never this one.
