#!/usr/bin/env bash
#
# Drive every public surface of a deployment over real HTTP.
#
# WHY THIS EXISTS AS WELL AS THE TEST SUITES
#
# `apps/api/e2e` calls the route handlers directly and `apps/web`'s vitest suite calls the
# modules. Both are worth having and neither one exercises the deployment: the routing layer, the
# environment the functions actually got, `vercel.json`, the middleware, compression, the edge.
# This does — and the first run of it found `RESEND_WEBHOOK_SECRET` missing from the API project
# entirely, which no local test could see because locally it comes from `.env.local`.
#
# WHAT EVERY CASE ASSERTS
#
# A reason, not merely "not a 500". A refusal arriving with the wrong status is a bug the caller
# cannot act on, and "any 4xx" is how an earlier version of the API e2e suite passed on a 405
# while claiming to test authentication.
#
# Usage:
#   scripts/check-deployment.sh https://sailo.store             # the web app
#   scripts/check-deployment.sh https://api.sailo.store  api    # the API app
#   scripts/check-deployment.sh https://docs.sailo.store docs   # the docs site
#   scripts/check-deployment.sh https://<preview>.vercel.app web <bypass-secret>
#
# A preview needs the bypass secret from the project's "Protection Bypass for Automation"
# setting, because previews are behind SSO. Pass it as the third argument.

set -uo pipefail

BASE="${1:?usage: check-deployment.sh <base-url> [web|api|docs] [bypass-secret]}"
BASE="${BASE%/}"
APP="${2:-web}"
BYPASS="${3:-}"
PASS=0
FAIL=0
SKIP=0

hdr=(-H "accept: application/json")
[ -n "$BYPASS" ] && hdr+=(-H "x-vercel-protection-bypass: $BYPASS")

# check <label> <expected-status> <method> <path> [body] [extra-header]
check() {
  local label="$1" want="$2" method="$3" path="$4" body="${5:-}" extra="${6:-}"
  local args=(-s --compressed -o /tmp/deploy-check-body -w "%{http_code}" --max-time 45 -X "$method" "${hdr[@]}")
  [ -n "$extra" ] && args+=(-H "$extra")
  [ -n "$body" ] && args+=(-H "content-type: application/json" -d "$body")
  local code
  code=$(curl "${args[@]}" "$BASE$path" 2>/dev/null)
  if [ "$code" = "$want" ]; then
    printf "  ✓ %-52s %s\n" "$label" "$code"
    PASS=$((PASS + 1))
  else
    printf "  ✗ %-52s got %s, wanted %s\n" "$label" "$code" "$want"
    printf "      %s\n" "$(head -c 160 /tmp/deploy-check-body 2>/dev/null | tr '\n' ' ')"
    FAIL=$((FAIL + 1))
  fi
}

# web-only <label> ... — routes that deliberately live on the web origin alone. Stripe's webhooks
# and every cron call `revalidateTag`, and a cache tag cannot be invalidated from another
# deployment; `docs/api-cutover.md` records why they never move.
web_only() {
  if [ "$APP" != "web" ]; then
    printf "  – %-52s not on the web origin, by design\n" "$1"
    SKIP=$((SKIP + 1))
    return
  fi
  check "$@"
}

# product-only <label> ... — the REST API, MCP, webhooks and cron. apps/docs serves prerendered
# pages about all of them and implements none: it holds no key, opens no database and has no
# `/api/v1` at all, so every one of these would be a 404 there rather than a refusal.
product_only() {
  if [ "$APP" = "docs" ]; then
    printf "  – %-52s not on the docs origin, by design\n" "$1"
    SKIP=$((SKIP + 1))
    return
  fi
  check "$@"
}

# docs-only <label> ... — the mirror image.
docs_only() {
  if [ "$APP" != "docs" ]; then
    printf "  – %-52s not on this origin, by design\n" "$1"
    SKIP=$((SKIP + 1))
    return
  fi
  check "$@"
}

contains() {
  local label="$1" path="$2" needle="$3"
  # To a file rather than a pipe: `grep -q` exits on first match, curl takes SIGPIPE, and
  # `pipefail` then calls a successful match a failure.
  curl -s --compressed --max-time 45 "${hdr[@]}" -o /tmp/deploy-check-body "$BASE$path" 2>/dev/null || true
  if grep -q "$needle" /tmp/deploy-check-body 2>/dev/null; then
    printf "  ✓ %-52s contains %s\n" "$label" "$needle"
    PASS=$((PASS + 1))
  else
    printf "  ✗ %-52s missing %s\n" "$label" "$needle"
    FAIL=$((FAIL + 1))
  fi
}

echo "════ $BASE  ($APP)"

echo "── it answers at all"
web_only "storefront root"                       200 GET  "/"
product_only "health probe, with no token"       200 GET  "/health"
web_only "robots.txt"                            200 GET  "/robots.txt"
web_only "sitemap.xml"                           200 GET  "/sitemap.xml"

echo "── REST v1 refuses without a key, and says which refusal it is"
product_only "GET /api/v1/shop"                  401 GET  "/api/v1/shop"
product_only "GET /api/v1/products"                     401 GET  "/api/v1/products"
product_only "GET /api/v1/orders"                401 GET  "/api/v1/orders"
product_only "GET /api/v1/contacts"              401 GET  "/api/v1/contacts"
product_only "POST /api/v1/contacts"             401 POST "/api/v1/contacts" '{"email":"a@b.co"}'
product_only "a bearer token that is not ours"   401 GET  "/api/v1/shop" "" "authorization: Bearer sailo_sk_not_a_real_key"

echo "── the contract describes itself"
product_only "openapi document"                  200 GET  "/api/v1/openapi.json"
if [ "$APP" != "docs" ]; then
  contains "openapi names the products endpoint"      "/api/v1/openapi.json" "/api/v1/products"
  contains "openapi declares bearer auth"             "/api/v1/openapi.json" "bearer"
fi

echo "── MCP, and the refusals it has to get right"
product_only "GET is 405 — no stream in this revision" 405 GET  "/api/mcp"
product_only "DELETE is 405 — no session to delete"    405 DELETE "/api/mcp"
product_only "a foreign browser origin is refused"     403 POST "/api/mcp" '{}' "origin: https://evil.example"
product_only "a malformed body is a JSON-RPC parse error" 400 POST "/api/mcp" '{'
product_only "a notification gets 202 and no body"     202 POST "/api/mcp" '{"jsonrpc":"2.0","method":"notifications/initialized"}'
product_only "a call without the protocol headers"     400 POST "/api/mcp" '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

echo "── webhooks authenticate from a signature, never a session"
product_only "resend webhook, unsigned"          400 POST "/api/resend/webhook" '{"type":"email.bounced","data":{}}'
web_only "stripe webhook, unsigned"              400 POST "/api/stripe/webhook" '{"type":"charge.succeeded"}'

echo "── cron is not open to the internet"
web_only "cron/sweep without the secret"         401 GET "/api/cron/sweep"
web_only "cron/broadcasts without the secret"    401 GET "/api/cron/broadcasts"

echo "── the partner stream authenticates from its token"
product_only "no token"                          404 GET "/api/partner/events"
product_only "a token of the wrong shape"        404 GET "/api/partner/events?token=short"

echo "── the documentation answers, and is readable by a machine"
docs_only "the landing page"                     200 GET "/"
docs_only "the REST reference"                   200 GET "/api"
docs_only "the webhook reference"                200 GET "/webhooks"
docs_only "the MCP reference"                    200 GET "/mcp"
docs_only "robots.txt"                           200 GET "/robots.txt"
docs_only "sitemap.xml"                          200 GET "/sitemap.xml"
docs_only "llms.txt"                             200 GET "/llms.txt"
docs_only "llms-full.txt"                        200 GET "/llms-full.txt"

# The two that would go quietly wrong. `/llms-full.txt` is generated by rendering the reference
# components into Markdown, and its first version elsewhere shipped a file whose "REST API"
# section read, in full, `<EndpointIndex />`. A component name in the output is the failure to
# watch for, and a path from the catalogue is what proves it did not happen.
if [ "$APP" = "docs" ]; then
  contains "llms-full carries the real endpoint table"  "/llms-full.txt" "/api/v1/orders"
  contains "llms-full carries the tool descriptions"    "/llms-full.txt" "list_orders"
fi

echo
echo "  $PASS passed, $FAIL failed, $SKIP not applicable to this origin"
exit $((FAIL > 0 ? 1 : 0))
