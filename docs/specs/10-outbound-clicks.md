# 10 — Outbound Click Tracking ("where do my customers go")

**Priority:** P2 · **Effort:** S · **Depends on:** nothing

## What

Count clicks on outbound surfaces — social icons, external link products,
"contact" rails — and chart them next to the existing "where are my customers
from". Reference: Stan's Analytics second panel.

## Current state

`/api/track` (`src/app/api/track/route.ts`) already receives visit beacons,
is rate-limited, validates UUIDs with `isUuid`, derives source/device via
`classifyVisit`/`parseUserAgent`, and writes into the partitioned `visits`
table (`ensurePartition` — the partitions live in a `visits_parts` schema
**outside `db:push`'s sight**; read the warning comment at the top of
`src/db/schema/analytics.ts` before touching anything).

## Design

- New `clicks` table (migration, production first): id, shopId,
  `targetHost text` (host only — the full URL can carry buyer PII in query
  strings; store host + a `kind` enum: `social | product_link | contact |
  other`), sessionId, createdAt. Plain table, no partitioning — clicks are
  ~10× rarer than visits; add an index on (shopId, createdAt). Revisit
  partitioning only if `check:load` says so.
- Extend `/api/track` with a `type: "click"` body variant (zod-discriminated
  union with the existing visit shape). Same rate limit budget; same
  `visitorId` session stitching.
- Client: a tiny `trackClick(host, kind)` helper using
  `navigator.sendBeacon` (fire-and-forget on unload — a click that navigates
  away must not lose the beacon; `fetch` with `keepalive: true` as fallback).
  Wire it into `social-icons.tsx`, the URL-product card, and the shop-footer
  contact links.

## Aggregation & UI

Extend the daily rollup cron (`/api/cron/rollup`) to fold clicks into
`visits_daily.dimensions` (the jsonb already holds `{countries, sources}` —
add `destinations`). Admin dashboard gets the second bar chart, grouped by
`targetHost`, same date-range control as the sources chart, respecting the
plan's `analyticsDays` limit from `src/lib/plans.ts`.

## Details that must not be missed

- Host is derived **server-side** from the posted URL with `new URL()` —
  never trust a client-supplied host string (a hostile page can post
  garbage; parse-fail → drop the beacon silently, 204 either way so the
  endpoint is not an oracle).
- Only track hosts different from the shop's own storefront; internal
  navigation is not "outbound".
- Consent: click counting is first-party, cookieless (visitorId is already
  used for visits) — same legal footing as visits; no new banner.
- Do-not-track the seller's own admin previews: the track route already has
  (or should mirror) the self-view suppression the visits path uses — check
  how visits avoid counting the seller and copy it.

## Testing

Scenario: post click beacons → rows with derived host; garbage URL → 204 and
no row; rollup folds destinations; dashboard query returns grouped counts.
Unit: URL parse edge cases (`javascript:`, protocol-relative, punycode —
store the punycoded host as-is).

## Done when

Clicks record with server-derived hosts, roll up into the daily dimensions,
render as the second chart, and hostile beacon bodies die silently.
