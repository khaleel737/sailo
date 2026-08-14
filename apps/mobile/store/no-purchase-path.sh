#!/usr/bin/env bash
#
# The mobile app must not be able to name a price.
#
# Sailo sells `pro` at $9.99/month and `business` at $19.99/month through
# Stripe Checkout on the web. Putting any part of that in the iOS app triggers
# Apple's in-app-purchase rules under Guideline 3.1.1, and the outcome is
# either a 30% cut on every subscription or a rejection. A seller upgrades on
# sailo.store; the app shows which plan they are on and what each tier
# unlocks, and stops there.
#
# This runs on every pull request rather than at release time, because the
# rule is easy to hold in mind while writing the release notes and easy to
# forget six months later when somebody adds a helpful "Upgrade" row to
# Settings.
#
# The patterns are identifiers and URLs, never English words. "checkout"
# appears in the orders screen's prose — an order was priced at checkout —
# and a gate that fires on comments is a gate that gets bypassed.
#
# `@sailo/core/plans` is the one that is easy to miss: it carries
# `monthlyCents: 999` and `yearlyCents`, and Metro does not tree-shake, so a
# single import anywhere in the mobile graph puts those numbers in the binary
# whether a screen renders them or not. Showing the current plan needs
# `PLAN_IDS` and `Features` from that module's *types*, which is not the same
# import and does not carry a price.
set -uo pipefail

mobile="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

patterns=(
  '@sailo/core/plans'
  'monthlyCents'
  'yearlyCents'
  'checkout\.stripe\.com'
  'billing\.stripe\.com'
  '/admin/billing'
  'sailo\.store/pricing'
  'createCheckoutSession'
  'billingPortal'
  'expo-in-app-purchases'
  'react-native-iap'
  'expo-store-kit'
  'RNIap'
)

failed=0
for pattern in "${patterns[@]}"; do
  found=$(grep -rnE "$pattern" \
    "$mobile/app" "$mobile/lib" "$mobile/components" "$mobile/package.json" \
    2>/dev/null || true)
  if [ -n "$found" ]; then
    printf '\033[31mpurchase path in the mobile app: %s\033[0m\n' "$pattern"
    printf '%s\n' "$found" | sed 's/^/  /'
    failed=1
  fi
done

if [ "$failed" -eq 0 ]; then
  printf '\033[32mno purchase path\033[0m — no plan price, checkout link or IAP library reaches the app\n'
else
  printf '\n'
  printf 'A seller upgrades on the web. The app may show the current plan and what\n'
  printf 'each tier unlocks; it may not show a price, an upgrade button, or a link\n'
  printf 'to a checkout page. Stripe Connect onboarding is unaffected — that is a\n'
  printf 'seller setting up a business account to receive money, not a purchase.\n'
fi
exit "$failed"
