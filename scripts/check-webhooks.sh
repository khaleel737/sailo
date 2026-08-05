#!/usr/bin/env bash
#
# Every webhook Stripe can send us, delivered the way Stripe sends it.
#
#   npm run check:webhooks
#
# Runs a production build behind `stripe listen`, fires every event type with
# `stripe trigger`, and insists each one comes back 2xx.
#
# The events we act on have to succeed for the obvious reason. The ones we
# ignore matter just as much: Stripe retries a non-2xx for three days and
# disables endpoints that keep failing, so an unhandled event answered with a
# 500 takes the whole integration down — including the payments that were
# working. Both are checked here.
#
# Nothing touches the dev server or the database beyond what the events
# themselves carry; triggered events name objects that don't exist in our
# tables, which is deliberate — "subject not found" must still be a 200.
set -uo pipefail

cd "$(dirname "$0")/.."

PORT="${CHECK_PORT:-3011}"
LOG="$(mktemp -t sailo-webhooks)"
ACCOUNT_ENDPOINT="localhost:${PORT}/api/stripe/webhook"
CONNECT_ENDPOINT="localhost:${PORT}/api/stripe/connect/webhook"

STRIPE_KEY="$(grep '^STRIPE_SECRET_KEY=' .env.local | cut -d= -f2-)"
if [ -z "$STRIPE_KEY" ]; then
  echo "STRIPE_SECRET_KEY is not in .env.local" >&2
  exit 1
fi

SERVER_PID=""
LISTEN_PID=""
cleanup() {
  [ -n "$LISTEN_PID" ] && kill "$LISTEN_PID" 2>/dev/null
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT

# The CLI signs with its own secret, not the Dashboard's, so the server under
# test has to be told that one — hence a server of our own rather than the dev
# server someone else may be using.
echo "Getting the CLI signing secret…"
WHSEC="$(stripe listen --api-key "$STRIPE_KEY" --print-secret 2>/dev/null | tail -1 | tr -d '\r')"
case "$WHSEC" in
  whsec_*) echo "  ${WHSEC:0:14}…" ;;
  *) echo "  could not read a signing secret from the CLI" >&2; exit 1 ;;
esac

echo "Building…"
npm run build >/dev/null 2>&1 || { echo "  build failed" >&2; exit 1; }

echo "Starting the app on :${PORT}…"
# The CLI signs both channels with the same secret, so both routes get it.
STRIPE_WEBHOOK_SECRET="$WHSEC" STRIPE_CONNECT_WEBHOOK_SECRET="$WHSEC" \
  npx next start -p "$PORT" >/dev/null 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 40); do
  curl -sf -o /dev/null "http://localhost:${PORT}/login" && break
  sleep 1
done

# Two channels, two routes. Without --forward-connect-to every connected
# account event would go to the account route, which is exactly the
# misconfiguration this whole split exists to prevent.
echo "Forwarding account events to ${ACCOUNT_ENDPOINT}"
echo "Forwarding connect events to ${CONNECT_ENDPOINT}"
stripe listen --api-key "$STRIPE_KEY" \
  --forward-to "$ACCOUNT_ENDPOINT" \
  --forward-connect-to "$CONNECT_ENDPOINT" >"$LOG" 2>&1 &
LISTEN_PID=$!
for _ in $(seq 1 30); do
  grep -q "Ready!" "$LOG" && break
  sleep 1
done
grep -q "Ready!" "$LOG" || { echo "  stripe listen never became ready" >&2; cat "$LOG"; exit 1; }
# The CLI colourises only when attached to a terminal, but this log is a file
# and may not be, so strip escape codes anyway.
#
# Always read through a process substitution, never `plain | grep -q`: grep
# exits at the first match, sed upstream dies of SIGPIPE, and `pipefail` then
# reports the whole pipeline as failed. That turned a found event into "never
# arrived", intermittently, depending on whether sed had finished writing.
plain() { sed 's/\x1b\[[0-9;]*m//g' "$LOG"; }
echo

# Everything the webhook acts on.
HANDLED_EVENTS="
checkout.session.completed
checkout.session.expired
charge.refunded
charge.dispute.created
charge.dispute.closed
account.updated
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.payment_failed
"

# Events we do not act on. Stripe sends these whether we asked for them or not,
# and each one still has to be acknowledged.
IGNORED_EVENTS="
charge.succeeded
charge.failed
customer.created
customer.updated
invoice.paid
invoice.finalized
payment_intent.succeeded
payment_intent.payment_failed
customer.subscription.trial_will_end
charge.dispute.updated
"

fire() {
  for event in $1; do
    printf '  %-42s' "$event"
    if stripe trigger "$event" --api-key "$STRIPE_KEY" >/dev/null 2>&1; then
      echo "sent"
    else
      echo "COULD NOT TRIGGER"
    fi
    sleep 2
  done
}

echo "Events we handle"
fire "$HANDLED_EVENTS"
echo
echo "Events we ignore — these must still be acknowledged"
fire "$IGNORED_EVENTS"

echo
echo "Waiting for deliveries to settle…"
sleep 6

# `stripe listen` logs the type on the way out and the status on the way back,
# joined by event id:
#   -->  charge.refunded [evt_1]
#   <--  [200] POST http://… [evt_1]
# Counting statuses alone would pass a run where the event we care about never
# fired, so the two lines are joined and reported per type.
awk '
  /-->/ { if (match($0, /evt_[A-Za-z0-9]+/)) { id=substr($0,RSTART,RLENGTH); for(i=1;i<=NF;i++) if ($i ~ /\./ && $i !~ /^http/) { type[id]=$i; break } } }
  /\[[0-9][0-9][0-9]\] POST/ {
    if (match($0, /evt_[A-Za-z0-9]+/)) { id=substr($0,RSTART,RLENGTH) }
    if (match($0, /\[[0-9][0-9][0-9]\]/)) { code=substr($0,RSTART+1,3) }
    t = (id in type) ? type[id] : "(unknown)"
    seen[t]++; if (code !~ /^2/) { bad[t]++; anybad=1 }
  }
  END {
    n=0
    for (t in seen) { n++; printf "  %-42s %3d delivered%s\n", t, seen[t], (t in bad ? sprintf("  %d NOT 2xx", bad[t]) : "") }
    printf "\n%d event types, %d total deliveries\n", n, NR
    exit anybad ? 1 : 0
  }
' <(plain) | sort
echo

DELIVERED=$(grep -c '\[[0-9][0-9][0-9]\] POST' <(plain) || true)
FAILED=$(grep '\[[0-9][0-9][0-9]\] POST' <(plain) | grep -cv '\[2[0-9][0-9]\] POST' || true)

if [ "${FAILED:-0}" -gt 0 ]; then
  echo "Non-2xx responses: ${FAILED}"
  grep '\[[0-9][0-9][0-9]\] POST' <(plain) | grep -v '\[2[0-9][0-9]\] POST' | sed 's/^/  /'
  echo
  echo "A non-2xx makes Stripe retry for three days and can disable the endpoint."
  exit 1
fi

if [ "${DELIVERED:-0}" -eq 0 ]; then
  echo "Nothing was delivered — the listener or the server never received anything." >&2
  exit 1
fi

# Every type we act on has to have been exercised, or the run proved nothing
# about it.
MISSING=""
for event in $HANDLED_EVENTS; do
  case "$event" in
    # Stripe closes a dispute on its own schedule, hours later — the trigger
    # only opens one. `npm run check:cards` drives both the won and lost
    # branches against a real dispute instead.
    charge.dispute.closed) continue ;;
  esac
  # Connected-account events are logged as "--> connect <type>", because they
  # travel on a different channel to the platform's own. Both count as arrived.
  grep -qE -- "--> (connect )?$event " <(plain) || MISSING="$MISSING $event"
done
if [ -n "$MISSING" ]; then
  echo "These handled events never arrived:$MISSING" >&2
  exit 1
fi

# Which of them only ever arrive from a connected account. This is the list
# that decides whether one registered endpoint is enough: Stripe will not send
# these to an endpoint that isn't marked for Connect, so if any handled event
# appears here, the account needs a second, Connect-enabled endpoint or buyer
# payments are silently never recorded.
CONNECT_ONLY=""
for event in $HANDLED_EVENTS; do
  if grep -qE -- "--> connect $event " <(plain) &&
     ! grep -qE -- "--> $event " <(plain); then
    CONNECT_ONLY="$CONNECT_ONLY $event"
  fi
done

if [ -n "$CONNECT_ONLY" ]; then
  echo "Arrived only from connected accounts:$CONNECT_ONLY"
  echo "  These need a webhook endpoint with Connect enabled. An endpoint"
  echo "  registered with connect=false never receives them."
  echo
fi

echo "Every delivery was acknowledged, and every handled event was exercised."

