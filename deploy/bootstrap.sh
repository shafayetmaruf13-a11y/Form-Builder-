#!/usr/bin/env bash
#
# Brings Formcraft up on a fresh machine.
#
#   ./deploy/bootstrap.sh you@example.com
#
# Writes `.env` (generating the secrets), then builds and starts
# docker-compose.server.yml. Safe to re-run: existing secrets are kept, because
# regenerating AUTH_SECRET signs everybody out and invalidates sign-in links
# that are already in flight.
#
# What you get: https://<your-ip>.sslip.io, with a real certificate and no DNS
# to configure. sslip.io is a public resolver that maps a hostname containing an
# IP back to that IP, which is enough for Let's Encrypt to issue for it.

set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=.env
COMPOSE="docker compose -f docker-compose.server.yml"
up=true

usage() {
  cat <<'EOF'
Usage: ./deploy/bootstrap.sh [OWNER_EMAIL] [OPTIONS]

  OWNER_EMAIL        The address that owns the workspace. Prompted for if
                     omitted and nothing is recorded yet.

Options:
  --host HOSTNAME    Serve on this name instead of <public-ip>.sslip.io.
                     Use this once you point a real domain at the machine.
  --env-only         Write .env and stop, without building or starting.
  -h, --help         This.
EOF
}

owner_email=""
host_override=""

while [ $# -gt 0 ]; do
  case "$1" in
    --host) host_override="${2:?--host needs a hostname}"; shift 2 ;;
    --env-only) up=false; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    *) owner_email="$1"; shift ;;
  esac
done

# --- what is already recorded -----------------------------------------------

# Reads one key out of an existing .env without sourcing it, so a stray
# character in a generated secret cannot execute anything.
existing() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -1
}

AUTH_SECRET="$(existing AUTH_SECRET)"
POSTGRES_PASSWORD="$(existing POSTGRES_PASSWORD)"
FORMCRAFT_DOMAIN="$(existing FORMCRAFT_DOMAIN)"
FORMCRAFT_OWNER_EMAIL="$(existing FORMCRAFT_OWNER_EMAIL)"

# --- secrets ----------------------------------------------------------------

# openssl is on every image this is likely to run on; the kernel is the
# fallback so a missing openssl is not a reason to stop.
random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr -d '\n'
  else
    head -c 32 /dev/urandom | base64 | tr -d '\n'
  fi
}

[ -n "$AUTH_SECRET" ] || AUTH_SECRET="$(random_secret)"
# Alphanumeric only: this password goes into a postgres:// URL, and a `/` or
# `@` in it would silently truncate the connection string.
[ -n "$POSTGRES_PASSWORD" ] || POSTGRES_PASSWORD="$(random_secret | tr -dc 'A-Za-z0-9' | head -c 32)"

# --- hostname ---------------------------------------------------------------

public_ip() {
  # The cloud's own metadata service first: it is on the link-local address,
  # needs no outbound access, and cannot be blocked by a network policy or be
  # wrong about which address is ours. OCI's v2 endpoint requires the header.
  ip="$(curl -fsS --max-time 3 -H 'Authorization: Bearer Oracle' \
        http://169.254.169.254/opc/v2/vnics/ 2>/dev/null \
        | tr -d ' "' | sed -n 's/.*publicIp:\([0-9.]*\).*/\1/p' | head -1)" || true
  if [ -n "${ip:-}" ]; then echo "$ip"; return 0; fi

  # AWS and most others expose it unauthenticated at a well-known path.
  ip="$(curl -fsS --max-time 3 \
        http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null \
        | tr -d '[:space:]')" || true
  case "${ip:-}" in
    *[0-9].[0-9]*) echo "$ip"; return 0 ;;
  esac

  # Then ask the internet what it sees. Works anywhere with outbound HTTPS,
  # and is the only option on a machine that is not a cloud instance.
  for url in https://api.ipify.org https://icanhazip.com https://ifconfig.me/ip; do
    ip="$(curl -fsS --max-time 10 "$url" 2>/dev/null | tr -d '[:space:]')" || continue
    case "$ip" in
      *[0-9].[0-9]*) echo "$ip"; return 0 ;;
    esac
  done
  return 1
}

if [ -n "$host_override" ]; then
  FORMCRAFT_DOMAIN="$host_override"
elif [ -z "$FORMCRAFT_DOMAIN" ]; then
  echo "Looking up this machine's public IP..."
  if ip="$(public_ip)"; then
    FORMCRAFT_DOMAIN="${ip//./-}.sslip.io"
    echo "  $ip  ->  $FORMCRAFT_DOMAIN"
  else
    echo "Could not determine the public IP. Pass one explicitly:" >&2
    echo "  ./deploy/bootstrap.sh you@example.com --host 1-2-3-4.sslip.io" >&2
    exit 1
  fi
fi

# --- owner ------------------------------------------------------------------

if [ -n "$owner_email" ]; then
  FORMCRAFT_OWNER_EMAIL="$owner_email"
elif [ -z "$FORMCRAFT_OWNER_EMAIL" ]; then
  # Worth insisting on. Without it the workspace is left ownerless and claimed
  # by whichever address signs in first — fine if that is certainly you, and a
  # giveaway if the URL reaches anybody else beforehand.
  if [ -t 0 ]; then
    printf 'Which email address owns this workspace? '
    read -r FORMCRAFT_OWNER_EMAIL
  else
    echo "No owner email given and not a terminal to ask at." >&2
    echo "  ./deploy/bootstrap.sh you@example.com" >&2
    exit 1
  fi
fi

case "$FORMCRAFT_OWNER_EMAIL" in
  ?*@?*.?*) : ;;
  *) echo "That does not look like an email address: $FORMCRAFT_OWNER_EMAIL" >&2; exit 1 ;;
esac

# --- write it out -----------------------------------------------------------

umask 077
cat > "$ENV_FILE" <<EOF
# Written by deploy/bootstrap.sh — gitignored, and must stay that way.
# Re-running the script keeps these secrets rather than rotating them.

# Signs sessions and the PDF worker's render tokens. Changing it signs
# everybody out and invalidates sign-in links in flight.
AUTH_SECRET=$AUTH_SECRET

# Only ever reached over the compose network; Postgres publishes no port.
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

# Caddy gets its certificate for exactly this name.
FORMCRAFT_DOMAIN=$FORMCRAFT_DOMAIN
AUTH_URL=https://$FORMCRAFT_DOMAIN

# Makes this address the workspace owner on the first migration. Later runs
# leave ownership alone — it moves by transfer in the members dashboard only.
FORMCRAFT_OWNER_EMAIL=$FORMCRAFT_OWNER_EMAIL

# --- Optional ---------------------------------------------------------------
# Unset, sign-in links and notifications are written to the container log and
# recorded in email_log as \`logged\` rather than \`sent\`. See docs/email-dns.md.
# RESEND_API_KEY=
# EMAIL_FROM="Formcraft <forms@example.com>"
# RESEND_WEBHOOK_SECRET=

# Strongly recommended before a fill link is circulated (architecture rule 6).
# TURNSTILE_SITE_KEY=
# TURNSTILE_SECRET_KEY=
EOF

echo
echo "Wrote $ENV_FILE"
echo "  host   https://$FORMCRAFT_DOMAIN"
echo "  owner  $FORMCRAFT_OWNER_EMAIL"
echo "  secrets generated (AUTH_SECRET, POSTGRES_PASSWORD)"

if [ "$up" != true ]; then
  echo
  echo "Stopping here as asked. To start:"
  echo "  $COMPOSE up -d --build"
  exit 0
fi

# --- up ---------------------------------------------------------------------

echo
echo "Building and starting. The first build takes a while — Chromium is a"
echo "large package and next build is not quick."
echo

$COMPOSE up -d --build

echo
echo "Waiting for the app to report healthy..."
# Through Caddy on loopback, with the real hostname forced so it serves the
# right certificate, and -k because that certificate is not for 127.0.0.1.
# Not via the public IP: on a NAT'd cloud instance a machine often cannot
# reach its own public address, so that would fail on a working deployment.
healthy=false
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null -k --max-time 5 \
      --resolve "$FORMCRAFT_DOMAIN:443:127.0.0.1" \
      "https://$FORMCRAFT_DOMAIN/health" 2>/dev/null; then
    healthy=true
    echo "  healthy"
    break
  fi
  sleep 5
done

if [ "$healthy" != true ]; then
  echo "  still not healthy after 5 minutes. What it says:" >&2
  $COMPOSE ps >&2 || true
  echo >&2
  $COMPOSE logs --tail 40 app >&2 || true
  exit 1
fi

cat <<EOF

Formcraft is at:

  https://$FORMCRAFT_DOMAIN

Signing in, with no email service configured: enter $FORMCRAFT_OWNER_EMAIL at
the sign-in page, then read the link out of the log and open it.

  $COMPOSE logs app | grep -A2 'Sign-in link'

If the page does not load at all, it is almost certainly the instance firewall
rather than this app — see §2 of docs/deploy-oracle-cloud.md.
EOF
