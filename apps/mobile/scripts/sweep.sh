#!/usr/bin/env bash
#
# Every screen, in every appearance and type size the phone can be set to.
#
# WHY THIS EXISTS
#
# Three things the app ships were never once looked at: dark mode, Dynamic Type
# above the default, and the notification a seller actually receives. None of
# them is reachable from a unit test, and all three are one `simctl` call away
# — the simulator can set the appearance, set the content size category, and
# deliver a real APNs payload, none of which needs a rebuild.
#
#   ./scripts/sweep.sh                    # light + dark, default type
#   ./scripts/sweep.sh --type             # add the accessibility type sizes
#   ./scripts/sweep.sh --push             # deliver a notification and shoot it
#   ./scripts/sweep.sh --out /tmp/shots   # where the PNGs go
#
# Reads the booted simulator and the Metro port from the environment, so it
# assumes the app is already installed and running against a dev server. See
# `maestro/README.md` for getting to that point.
#
# THE TRAP THIS SCRIPT AVOIDS
#
# Fast Refresh silently stops reaching an app that has been reinstalled or that
# lost its Metro binding, and a screenshot of a stale bundle looks exactly like
# a screenshot of a passing change. Every mode change below therefore *cold
# launches* rather than relying on a live reload — slower per shot, and the only
# way the picture is of the code on disk.

set -euo pipefail

BUNDLE="store.sailo.app"
PORT="${METRO_PORT:-8083}"
OUT="${SWEEP_OUT:-./.sweep}"
DO_TYPE=0
DO_PUSH=0

while [ $# -gt 0 ]; do
  case "$1" in
    --type) DO_TYPE=1 ;;
    --push) DO_PUSH=1 ;;
    --out) OUT="$2"; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

DEVICE=$(xcrun simctl list devices booted | grep -oE '\(([0-9A-F-]{36})\)' | head -1 | tr -d '()')
if [ -z "$DEVICE" ]; then
  echo "No booted simulator. Boot one and install the app first." >&2
  exit 1
fi

mkdir -p "$OUT"
echo "device  $DEVICE"
echo "metro   localhost:$PORT"
echo "out     $OUT"

# The routes worth a picture. Every one is reachable by deep link, which is what
# makes this possible without a single tap — expo-router registers the scheme
# and `openurl` drives it.
ROUTES=(
  "/:home"
  "/orders:orders"
  "/store:store"
  "/store/payments:payments"
  "/insights:insights"
  "/settings:settings"
  "/settings/notifications:notifications"
)

relaunch() {
  xcrun simctl terminate "$DEVICE" "$BUNDLE" >/dev/null 2>&1 || true
  sleep 2
  xcrun simctl launch "$DEVICE" "$BUNDLE" -RCT_jsLocation "localhost:$PORT" >/dev/null
  # A cold bundle takes a while to execute; there is no signal to wait on that
  # is cheaper than waiting.
  sleep "${LAUNCH_WAIT:-75}"
}

shoot() {
  local label="$1"
  for entry in "${ROUTES[@]}"; do
    local path="${entry%%:*}"
    local name="${entry##*:}"
    xcrun simctl openurl "$DEVICE" "sailo://$path" >/dev/null 2>&1 || true
    sleep 6
    xcrun simctl io "$DEVICE" screenshot "$OUT/${label}--${name}.png" >/dev/null 2>&1 || true
    printf '  %s\n' "${label}--${name}.png"
  done
}

for appearance in light dark; do
  echo "== appearance: $appearance"
  xcrun simctl ui "$DEVICE" appearance "$appearance" >/dev/null
  relaunch
  shoot "$appearance"
done

if [ "$DO_TYPE" = "1" ]; then
  # The two ends of the range. `MAX_SCALE` in `text.tsx` caps the large steps on
  # purpose — at 310% a 44pt hero is 136pt and three words fill the screen — and
  # this is the only way to see whether the caps hold a layout together.
  for size in extra-small accessibility-extra-extra-extra-large; do
    echo "== content size: $size"
    xcrun simctl ui "$DEVICE" appearance light >/dev/null
    xcrun simctl ui "$DEVICE" content_size "$size" >/dev/null
    relaunch
    shoot "type-$size"
  done
  xcrun simctl ui "$DEVICE" content_size large >/dev/null
fi

if [ "$DO_PUSH" = "1" ]; then
  echo "== push"
  # A terminated app, which is the case a seller is actually in when an order
  # arrives — and the one where iOS draws the banner rather than handing it to
  # the in-app handler.
  xcrun simctl terminate "$DEVICE" "$BUNDLE" >/dev/null 2>&1 || true
  sleep 3
  cat > "$OUT/order.apns" <<'JSON'
{
  "Simulator Target Bundle": "store.sailo.app",
  "aps": {
    "alert": { "title": "New order · $99.00", "body": "Bag Black 2024 — Khaleel Musleh" },
    "sound": "default"
  },
  "body": { "kind": "order", "orderId": "sweep-probe" },
  "kind": "order",
  "orderId": "sweep-probe"
}
JSON
  xcrun simctl push "$DEVICE" "$OUT/order.apns" >/dev/null
  sleep 4
  xcrun simctl io "$DEVICE" screenshot "$OUT/push--banner.png" >/dev/null
  echo "  push--banner.png"
  # Notification permission has to already be granted for the banner to draw.
  # `simctl privacy` cannot grant it and Maestro's iOS permission block does not
  # take — the only reset is uninstall/reinstall, after which iOS treats it as
  # undetermined and the app can ask.
fi

xcrun simctl ui "$DEVICE" appearance light >/dev/null
echo "done — $(ls "$OUT" | wc -l | tr -d ' ') files in $OUT"
