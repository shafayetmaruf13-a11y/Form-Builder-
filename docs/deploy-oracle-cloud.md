# Deploying Formcraft on Oracle Cloud

**You run these steps.** Nothing in this repository has OCI credentials, and
standing up a public endpoint that collects other people's form submissions is
the owner's decision, not a side effect of a build.

The shape: one compute instance running two containers, talking to OCI's
managed PostgreSQL. The application does not change — the database stays
Postgres via Drizzle, exactly as the stack fixes it. Only `DATABASE_URL` moves.

> Oracle renames things in its console more often than it changes them. Where
> this says "look for X", trust the console over the exact wording here.

---

## What you are building

```
         internet
            │  443
   ┌────────▼─────────────────────────────┐
   │ Compute instance (Ampere A1, arm64)  │
   │                                      │
   │  caddy ──► app  ──┐                  │
   │            │      │ loopback         │
   │            └──────┘ (PDF worker      │
   │                      fetches its     │
   │  volume: /data/uploads  own pages)   │
   └──────────────────┬───────────────────┘
                      │ private subnet, TLS
         ┌────────────▼──────────────┐
         │ OCI Database w/ PostgreSQL│
         └───────────────────────────┘
```

---

## 1. The instance

**Shape.** Ampere A1 (`VM.Standard.A1.Flex`) is in the Always Free tier and is
the right choice — but note it is **arm64**. That is fine: the Dockerfile
installs the distribution's Chromium, which exists for arm64, and the image
builds natively on the instance.

Give it **at least 2 OCPU and 6 GB**. Not the 1 GB `E2.1.Micro`: a PDF render
is a headless browser, and it will be killed by the OOM reaper on that shape.

**Image.** Ubuntu 22.04 or 24.04 (arm64). Oracle Linux works too; the firewall
commands below differ.

**Disk.** The 50 GB boot volume is plenty. Uploaded logos and file answers live
on a Docker volume on that disk — see §7 about backing it up.

## 2. Networking — the step everyone loses an hour to

**Two firewalls, and both must allow the traffic.**

1. **The VCN security list or NSG**, in the console: add stateful ingress for
   TCP **80** and **443** from `0.0.0.0/0`.
2. **The instance's own firewall.** Oracle's images ship with iptables rules
   that drop everything but SSH, and the security list says nothing about them.
   This is why "I opened the ports and it still times out" is the single most
   common OCI complaint.

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

## 3. The database

Create an **OCI Database with PostgreSQL** instance in the **same VCN**, on a
private subnet. Then:

- Allow ingress on **5432** from the compute instance's subnet CIDR only. Not
  from the internet — the app is the only thing that needs to reach it.
- Create a database named `formcraft` and a role for the app.
- Connections are TLS. Put `?sslmode=require` in the URL; if you have the CA on
  the instance, `verify-full` with `sslrootcert=` is better and catches a
  misdirected connection rather than merely encrypting one.

Nothing in the schema changes. Drizzle's Postgres dialect, `jsonb`, the partial
unique index enforcing one owner, and the single-statement upserts the rate
limiter and idempotency depend on all work exactly as they do locally.

## 4. Docker

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker "$USER"
newgrp docker     # or log out and back in
```

## 5. Deploy

```bash
git clone -b main-ry1qm3 https://github.com/shafayetmaruf13-a11y/Form-Builder-.git
cd Form-Builder-

cp .env.production.example .env.production
openssl rand -base64 32          # paste into AUTH_SECRET
$EDITOR .env.production          # DATABASE_URL, FORMCRAFT_DOMAIN, AUTH_URL
```

Point an **A record** at the instance's public IP and let it propagate _before_
starting — Caddy asks for a certificate on boot, and Let's Encrypt rate-limits
repeated failures for the same name.

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

The `migrate` container applies migrations and exits; the app waits for it to
finish. First build takes a while on an Ampere instance — Chromium is a large
package and `next build` is not quick.

```bash
docker compose -f docker-compose.prod.yml logs -f app
curl -sf https://forms.example.com/health && echo OK
```

**The build needs outbound access to `fonts.googleapis.com`.** `next/font`
downloads the four families at build time and serves them from your own origin
afterwards. If that is blocked, the build fails — which is the good outcome.
The bad one is a build that silently falls back and makes every PDF stop
matching its design.

## 6. First sign-in

The first account to sign in claims the workspace and becomes the owner, and
after that only invited addresses may sign in. So **sign in yourself first**,
before the URL is shared.

With no `RESEND_API_KEY`, the sign-in link is written to the container log
rather than emailed — which is enough to claim the workspace:

```bash
docker compose -f docker-compose.prod.yml logs app | grep -A2 "Sign-in link"
```

Then configure Resend and the DNS records in [email-dns.md](./email-dns.md).

## 7. The things that will bite you later

**Uploads are on a Docker volume, not in object storage.** `docker compose
down -v` deletes them, and so does losing the instance. Until `lib/storage`
gains an R2 implementation, back the volume up:

```bash
docker run --rm -v formcraft_uploads:/data -v "$PWD:/backup" alpine \
  tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

**Database backups are the managed service's job — check they are on.** The app
has no export of its own beyond per-form Excel, and a lost `form_versions` row
takes every submission that references it (architecture rule 4 cuts both ways).

**Memory.** `mem_limit: 2g` in the compose file stops a runaway render taking
the host down. If PDF downloads start failing under load, that limit is the
first thing to look at — and `docker stats` will tell you before your users do.

**Updating:**

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Migrations run automatically and are idempotent — CI proves that by applying
them twice on every push.

## 8. Before you share a link

- [ ] `AUTH_SECRET` is a fresh random value, not the example
- [ ] You have signed in and claimed the workspace
- [ ] `https://` works and `http://` redirects to it
- [ ] Postgres is reachable only from the app's subnet
- [ ] **Turnstile keys are set** — rule 6 wants them, and a public fill page
      without them has only rate limiting between it and a patient bot
- [ ] The uploads volume is being backed up
- [ ] Database automatic backups are enabled
- [ ] SPF, DKIM and DMARC are published if you are sending mail

## Not covered here

Running the end-to-end suite against this deployment. It creates and deletes
forms, submissions and sessions freely, and exhausts rate-limit counters on
purpose. Point it at a disposable database, never this one.
