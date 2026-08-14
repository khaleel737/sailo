#!/usr/bin/env bash
#
# What is actually inside the thing you are about to upload.
#
# `eas.json` says the production profile builds against `api.sailo.store`.
# That is a claim about the source. This reads the binary, because the two can
# differ: an `.env` that outranks the profile, a build kicked off from the
# wrong branch, a channel that was renamed after the last release. Every one of
# those produces a build that installs, launches, looks right and talks to the
# wrong server — and you find out from a seller, not from a test.
#
#   apps/mobile/store/verify-artifact.sh path/to/app.ipa
#   apps/mobile/store/verify-artifact.sh path/to/app.aab
#   apps/mobile/store/verify-artifact.sh https://expo.dev/artifacts/eas/….ipa
#
# An .ipa and an .aab are both zip files, and the JS lives inside as a Hermes
# bundle. Hermes keeps its string table in the clear, so `grep -a` over the
# unpacked archive finds any literal the JS holds — which is exactly what an
# inlined `process.env.EXPO_PUBLIC_*` becomes.
set -uo pipefail

artifact="${1:-}"
if [ -z "$artifact" ]; then
  echo "usage: verify-artifact.sh <path-or-url-to .ipa/.aab/.apk>" >&2
  exit 2
fi

failed=0
pass() { printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; failed=1; }
note() { printf '       %s\n' "$1"; }
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if [ "${artifact#http}" != "$artifact" ]; then
  echo "downloading $artifact"
  curl -fsSL --max-time 900 -o "$work/artifact" "$artifact" || {
    echo "could not download the artifact" >&2
    exit 1
  }
  local_file="$work/artifact"
else
  [ -f "$artifact" ] || { echo "no such file: $artifact" >&2; exit 1; }
  local_file="$artifact"
fi

unpacked="$work/unpacked"
mkdir -p "$unpacked"
unzip -qq -o "$local_file" -d "$unpacked" || { echo "not a zip archive" >&2; exit 1; }

printf 'artifact: %s (%s)\n' "$artifact" "$(du -h "$local_file" | cut -f1)"

# ── The JS bundle, which is the only part these checks may read ──────────────
#
# Scoped to the bundle rather than the whole archive on purpose. A release
# .ipa carries React Native's own frameworks, and those contain the string
# "localhost" in dev-server plumbing that never runs — searching the archive
# for it would fail every single build and teach everyone to ignore this
# script. The inlined `process.env.EXPO_PUBLIC_*` values and every literal the
# app's own code holds are in the bundle and nowhere else, so that is where to
# look.
section "JS bundle"

bundles=$(find "$unpacked" \( -name 'main.jsbundle' -o -name 'index.android.bundle' \) 2>/dev/null)
if [ -z "$bundles" ]; then
  fail "no JS bundle in the archive — this is not an Expo release build"
  printf '\n\033[31martifact failed verification — do not submit\033[0m\n'
  exit 1
fi
printf '%s\n' "$bundles" | sed "s|$unpacked/|       |"

grep_bundles() { printf '%s\n' "$bundles" | tr '\n' '\0' | xargs -0 grep -la -- "$1" 2>/dev/null; }

# ── The origins the binary will actually talk to ─────────────────────────────
#
# Asserted positively and negatively. "Contains api.sailo.store" is not enough
# on its own: a build can hold the production URL as an unused fallback and
# still default to a laptop, which is why the absence of every development
# origin is a separate check.
section "Origins baked into the bundle"

for want in 'https://api.sailo.store' 'https://sailo.store'; do
  if [ -n "$(grep_bundles "$want")" ]; then
    pass "contains $want"
  else
    fail "does not contain $want — this build points somewhere else"
  fi
done

for banned in 'localhost' '127.0.0.1' '10.0.2.2' 'ngrok' '.vercel.app' 'staging.sailo'; do
  hits=$(grep_bundles "$banned")
  if [ -n "$hits" ]; then
    fail "a development origin survived into the bundle: $banned"
    printf '%s\n' "$hits" | sed "s|$unpacked/|       |"
  fi
done

# ── No purchase path, proven against the binary ──────────────────────────────
#
# `preflight.sh` makes the same assertion against the source. This one is the
# only version that cannot be wrong: whatever the import graph turned out to
# be, the price either is in this bundle or it is not. `monthlyCents` and
# `yearlyCents` are object keys, so they survive minification intact.
section "No purchase path"

purchase_hits=0
for banned in 'monthlyCents' 'yearlyCents' 'checkout.stripe.com' 'billing.stripe.com' '/admin/billing' 'sailo.store/pricing'; do
  files=$(grep_bundles "$banned")
  if [ -n "$files" ]; then
    fail "the bundle can name a price or reach a checkout: $banned"
    printf '%s\n' "$files" | sed "s|$unpacked/|       |"
    purchase_hits=1
  fi
done
[ "$purchase_hits" -eq 0 ] && pass "no plan price and no checkout URL in the bundle"

# ── iOS: version, channel and privacy manifests ──────────────────────────────
section "iOS specifics"

app_dir=$(find "$unpacked" -maxdepth 2 -type d -name '*.app' | head -1)
if [ -z "$app_dir" ]; then
  note "not an .ipa — skipping"
else
  python3 - "$app_dir/Info.plist" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'rb') as fh:
    p = plistlib.load(fh)
for key in ('CFBundleIdentifier', 'CFBundleShortVersionString', 'CFBundleVersion',
            'ITSAppUsesNonExemptEncryption'):
    print(f'       {key}: {p.get(key, "(not set)")}')
for key in ('NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription'):
    value = p.get(key)
    print(f'       {key}: {"set" if value else "MISSING"}')
PY

  # Export compliance. Sailo uses HTTPS and nothing else, which is exempt —
  # but only if the binary says so. Left unset, App Store Connect stops every
  # single upload on a manual questionnaire, which is a day lost per release
  # for an answer that never changes.
  if grep -qa 'ITSAppUsesNonExemptEncryption' "$app_dir/Info.plist"; then
    pass "export compliance answered in Info.plist"
  else
    fail "ITSAppUsesNonExemptEncryption is not in Info.plist"
    note "every upload will then wait on the manual export-compliance question."
    note "the fix is app.json's ios.infoPlist — outside this work order's paths."
  fi

  # Required-reason APIs. Each Expo module and React Native itself ships its
  # own PrivacyInfo.xcprivacy inside its framework, and Apple reads the union.
  # Printed rather than asserted: what matters is that a human can see the
  # list against the App Privacy answers, and a count would go stale the first
  # time a dependency is added.
  section "Privacy manifests in the build"
  manifests=$(find "$unpacked" -name 'PrivacyInfo.xcprivacy' | sed "s|$unpacked/||")
  if [ -z "$manifests" ]; then
    fail "no PrivacyInfo.xcprivacy anywhere in the .ipa"
  else
    pass "$(printf '%s\n' "$manifests" | grep -c .) privacy manifests present"
    printf '%s\n' "$manifests" | sed 's/^/       /'
    note "cross-check these against store/compliance.md before answering the"
    note "App Privacy questionnaire."
  fi
fi

# ── Android: version and application id ──────────────────────────────────────
section "Android specifics"

if [ -f "$unpacked/BundleConfig.pb" ] || [ -d "$unpacked/base" ]; then
  pass "Android App Bundle"
  find "$unpacked" -name 'index.android.bundle' | sed "s|$unpacked/|       |"
elif [ -f "$unpacked/AndroidManifest.xml" ]; then
  pass "Android APK"
else
  note "not an Android artifact — skipping"
fi

printf '\n'
if [ "$failed" -eq 0 ]; then
  printf '\033[32martifact verified\033[0m\n'
else
  printf '\033[31martifact failed verification — do not submit\033[0m\n'
fi
exit "$failed"
