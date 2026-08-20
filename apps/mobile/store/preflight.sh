#!/usr/bin/env bash
#
# Everything that has to be true before a build is handed to a store.
#
# The four workspace gates — typecheck, test, lint, knip — say the code is
# sound. None of them says the *release* is sound, and the things that get an
# app rejected all live in that gap: a price that reached the iOS binary, a
# support URL that 404s, a placeholder still sitting in eas.json, a reviewer
# who cannot find account deletion. Each of those is a week of round-trip with
# App Review, so each is a check here instead.
#
# Run from anywhere:
#
#   apps/mobile/store/preflight.sh
#
# Every check prints its own verdict and the script keeps going, so one run
# tells you everything that is wrong rather than the first thing. It exits
# non-zero if any check failed.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mobile="$(cd "$here/.." && pwd)"

failed=0
pass() { printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; failed=1; }
note() { printf '       %s\n' "$1"; }
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ── 1. No purchase path on iOS ───────────────────────────────────────────────
#
# Its own script because it is also a pull-request gate: this rule has to hold
# on every commit, not only on the day somebody decides to ship. Read
# `no-purchase-path.sh` for what it looks for and why each pattern is on the
# list.
section "1 · No purchase path in the mobile app"

purchase_out=$("$here/no-purchase-path.sh" 2>&1)
if [ $? -eq 0 ]; then
  pass "no plan price, checkout link or IAP library reaches the app"
else
  fail "a purchase path reaches the mobile app"
  printf '%s\n' "$purchase_out" | sed 's/^/       /'
fi

# ── 2. Account deletion is reachable ─────────────────────────────────────────
#
# Guideline 5.1.1(v): an app that offers account creation must offer account
# deletion, in the app, without emailing anybody. `account.delete` exists in
# packages/api — that is not the same as a seller being able to find it, and
# App Review checks the screen, not the router.
section "2 · Account deletion reachable from Settings"

settings="$mobile/app/(tabs)/settings/index.tsx"
if [ ! -f "$settings" ]; then
  fail "settings screen not found at ${settings#"$mobile"/}"
elif grep -qE 'account\.delete' "$settings"; then
  pass "Settings calls account.delete"
else
  fail "Settings does not call account.delete — App Review will reject this"
  note "the procedure exists in packages/api/src/routers/account.ts; the screen"
  note "has to expose it. Not fixable from this work order — report it."
fi

# ── 3. No placeholders left in the release config ────────────────────────────
#
# `ascAppId` and `appleTeamId` cannot be committed until the App Store Connect
# app record exists, and the reviewer's phone number and demo password are
# deliberately not invented here. They are marked rather than omitted so that
# forgetting them is loud.
section "3 · Release config has no placeholders"

for file in "$mobile/eas.json" "$mobile/store.config.json"; do
  if grep -q 'REPLACE_BEFORE_FIRST_SUBMIT' "$file"; then
    fail "${file#"$mobile"/} still has REPLACE_BEFORE_FIRST_SUBMIT"
    grep -n 'REPLACE_BEFORE_FIRST_SUBMIT' "$file" | sed 's/^/       /'
  else
    pass "${file#"$mobile"/} filled in"
  fi
done

# ── 4. The URLs the listing claims actually answer ───────────────────────────
#
# A support URL that does not resolve is a rejection, and it is the kind that
# happens because a page was planned rather than built. Checked over the
# network on purpose: the point is what a reviewer's browser gets, not what
# the repo says.
#
# A status code alone proves nothing here. `apps/web` routes `/[handle]` as a
# catch-all for seller storefronts, so *every* unclaimed top-level path answers
# 200 with a "Shop not found" page — `/support` included. A plain 200 check
# would have called that live and shipped a listing pointing at a dead end, so
# the body is read and the storefront miss is treated as the 404 it is.
section "4 · Listing URLs are live"

if ! command -v curl >/dev/null 2>&1; then
  fail "curl not available — cannot verify listing URLs"
else
  urls=$(node -e '
    const c = require("'"$mobile"'/store.config.json");
    const info = c.apple.info["en-US"];
    for (const k of ["marketingUrl", "supportUrl", "privacyPolicyUrl"])
      if (info[k]) console.log(k + " " + info[k]);
  ')
  while read -r key url; do
    [ -z "${url:-}" ] && continue
    body=$(curl -sS -L --max-time 20 -w '\n%{http_code}' "$url" 2>/dev/null || printf '\n000')
    code=$(printf '%s' "$body" | tail -1)
    if [ "$code" != "200" ]; then
      fail "$key → $url returned $code"
    elif printf '%s' "$body" | grep -qi 'Shop not found'; then
      fail "$key → $url is the storefront catch-all, not a page"
      note "it answers 200 because /[handle] matches anything. The page does"
      note "not exist yet — that is an apps/web change, not one this work"
      note "order can make."
    else
      pass "$key → $url"
    fi
  done <<< "$urls"
fi

# ── 5. Screenshots exist for every size the listing claims ───────────────────
#
# App Store Connect will not accept a version without an iPhone 6.7" set, and
# `eas metadata:push` fails on a path that is not there. The check reads
# `supportsTablet` from app.json at run time: while it is true (as it is
# today), the iPad 13" set is mandatory too; flip it to false and the iPad
# requirement falls away on its own.
section "5 · Screenshots"

tablet=$(node -e 'console.log(require("'"$mobile"'/app.json").expo.ios.supportsTablet === true)')
if [ "$tablet" = "true" ]; then
  note "app.json has supportsTablet: true — iPad screenshots are mandatory"
  required_types="APP_IPHONE_67 APP_IPAD_PRO_3GEN_129"
else
  required_types="APP_IPHONE_67"
fi

for type in $required_types; do
  listed=$(node -e '
    const c = require("'"$mobile"'/store.config.json");
    const shots = (c.apple.info["en-US"].screenshots || {})["'"$type"'"] || [];
    console.log(shots.join("\n"));
  ')
  if [ -z "$listed" ]; then
    fail "store.config.json claims no $type screenshots"
    note "see store/screenshots/README.md for the shot list and the block to paste"
    continue
  fi
  missing=0
  while read -r shot; do
    [ -z "$shot" ] && continue
    if [ ! -f "$mobile/$shot" ]; then
      fail "$type references a file that is not there: $shot"
      missing=1
    fi
  done <<< "$listed"
  [ "$missing" -eq 0 ] && pass "$type: $(printf '%s\n' "$listed" | grep -c .) screenshots present"
done

# ── 6. The App Store icon ────────────────────────────────────────────────────
#
# Apple rejects a 1024×1024 marketing icon that carries an alpha channel, and
# it rejects it *after* the upload, by email, a day later. Expo builds that
# icon out of `assets/icon.png` at prebuild without flattening it, so a
# designer exporting a transparent PNG — the sane default in every drawing
# program — costs a release cycle.
#
# Read out of the PNG header rather than with a tool that may not be on the
# runner: byte 25 of an uncompressed IHDR is the colour type, and 4 and 6 are
# the two that carry alpha. `tRNS` is palette transparency, which counts too.
section "6 · App Store icon"

icon="$mobile/assets/icon.png"
if [ ! -f "$icon" ]; then
  fail "assets/icon.png is missing — app.json points at it"
else
  verdict=$(python3 - "$icon" <<'PY'
import struct, sys
raw = open(sys.argv[1], 'rb').read()
if raw[:8] != b'\x89PNG\r\n\x1a\n':
    print('FAIL not a PNG'); raise SystemExit
w, h = struct.unpack('>II', raw[16:24])
colour = raw[25]
alpha = colour in (4, 6) or b'tRNS' in raw
if (w, h) != (1024, 1024):
    print(f'FAIL {w}x{h}, the App Store icon must be 1024x1024')
elif alpha:
    print('FAIL 1024x1024 but carries alpha — Apple rejects a transparent icon')
else:
    print('OK 1024x1024, opaque')
PY
)
  if [ "${verdict%% *}" = "OK" ]; then
    pass "assets/icon.png ${verdict#OK }"
  else
    fail "assets/icon.png ${verdict#FAIL }"
    note "app.json names this file; flattening it is not this work order's edit"
  fi
fi

# ── 7. The metadata itself is valid ──────────────────────────────────────────
#
# `eas metadata:lint` runs the same JSON schema and the same Apple business
# rules the push will run, so a character limit or an unknown category is
# caught here rather than half way through an upload.
#
# It resolves the iOS submit profile before it reads the metadata, so while
# check 3 is still failing this one cannot run at all. That is the right order
# — there is nothing to lint if there is nowhere to push it — and it is why a
# non-zero exit is reported rather than counted: a runner with no EXPO_TOKEN
# fails here for a reason that has nothing to do with the listing.
section "7 · store.config.json validates"

lint_out=$(cd "$mobile" && npx --yes eas-cli metadata:lint --profile production 2>&1)
if [ $? -eq 0 ]; then
  pass "eas metadata:lint clean"
else
  note "eas metadata:lint did not pass — output follows. Not counted as a"
  note "failure on its own; fix checks 1-6 first, then read this."
  printf '%s\n' "$lint_out" | sed 's/^/       /'
fi

printf '\n'
if [ "$failed" -eq 0 ]; then
  printf '\033[32mpreflight passed\033[0m\n'
else
  printf '\033[31mpreflight failed — do not submit\033[0m\n'
fi
exit "$failed"
