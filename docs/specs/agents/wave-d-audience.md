# Wave D — Audience, automation and analytics

You are one of six agents building the Sailo 2026-08 release in
`~/Desktop/Sailo`. You own **five** items: who the buyers are, what gets sent to
them, what gets recovered, and what the seller can see.

Migrations **0047–0051**. Claim each with a one-line commit to
`apps/web/drizzle/` before writing the SQL.

**Order is fixed: D1 → D2 → D3 → D4 → D5.** D2 needs D1's audience, D5 counts
what D2 and D3 produce, and D4 shares D2's runner.

---

## D1 — Contacts, lists, custom fields, unsubscribes · L · `0047_audience.sql`

`docs/specs/34-contacts-lists-custom-fields.md`. Unifies two half-audiences —
`clients` built from orders, and the newsletter `subscribers` — into one contact
model.

**New tables:** `contact_lists`, `contact_list_members`, `contact_fields`,
`contact_field_values`.

**Its eight rules (§"The eight rules, adopted") are the correctness floor for
everything in this release that sends mail.** Implement all eight; D2 inherits
every one.

> ### One change to the spec as written
>
> **Contact identity is `(shop, email OR phone)`, either sufficient.**
>
> Email is the common case and the one every send path needs — a card checkout
> collects it, and this spec's audiences are email audiences. But
> `README.md` notes that *"chat rails don't [require an email], because the
> conversation itself is the contact"*, so a shop running them has real buyers
> with no address. Keying identity on email drops them from the seller's own
> customer list, which is a bug in the CRM before it is anything to do with
> sending.

**Do not break** what already ships and is a legal floor rather than a feature:
consent-only audiences, RFC 8058 one-click unsubscribe (`POST
/api/unsubscribe/[token]`, confirm at `/u/[token]`, and a GET that deliberately
unsubscribes nobody), and bounce/complaint suppression from the
signature-verified Resend webhook — all in `packages/marketing/src/broadcasts/`.

Checkout custom fields (§"Checkout custom fields") are the other half of this
spec, and **Wave C's intake forms depend on them.** Land them and say so.

---

## D2 — Email automations · XL · `0048_automations.sql`

`docs/specs/30-email-automations.md`. The headline gap — `README.md` says
*"Not built: flows"* three times.

**New tables:** `automations`, `automation_steps`, `automation_runs`,
`automation_emails`. Four triggers and four steps in v1.

**Reuse, do not reinvent.** §"Build on what exists" lists what already works:
`packages/marketing/src/broadcasts/markdown.ts`, `render.ts`, `segment-sql.ts`,
and `packages/workflows/src/webhooks/attempt.ts`. **The runner is new; the
rendering, sending, unsubscribe footer and suppression checks are not**, and
rewriting them drops the compliance behaviour they carry.

> ### The one thing that must not happen in this wave
>
> **Do not touch `packages/marketing/src/lifecycle/steps.ts`, and leave the HQ
> Journeys screen reading it.**
>
> The twelve lifecycle rungs are Sailo's own onboarding funnel *to sellers*.
> They look like they belong in `automations` and they do not — the argument is
> in `GAP-2026-08-easytools.md` §3.2 and in the header comment of
> `apps/hq/src/app/(panel)/marketing/journeys/page.tsx`. **A change that
> migrates them here should be refused, including by you.**

**Worth adding beyond the spec, because it is the one Sailo shape here:** a step
whose action is **"open WhatsApp with this message pre-filled"** — Sailo
composes and schedules, the seller presses send from their own number, in the
thread the order already lives in. There is no WhatsApp Business API here, and
this is not a workaround for that: it is the same handoff the checkout already
uses. It reaches every country, needs no template approval, and costs nothing.

Also worth wiring: the **transactional** follow-ups that reach every rail, not
just email — bank transfer unpaid, COD arriving tomorrow, *did it arrive?*
(spec 44 already built that link and route — `arrivalUrl()` in
`packages/commerce/src/disputes/arrival.ts`, **use it**), review request,
back-in-stock (Wave B's `stock_requests`).

**Ceilings.** Three daily send ceilings exist and are separate on purpose: a
campaign must never eat the budget carrying a buyer's receipt (see
`BROADCAST_DAILY_CEILING` in the root `README.md`). **Your send path spends
quota, so its ceiling fails closed.**

**Loops.** A step graph can cycle. Decide what stops an automation re-entering
itself and write the reason beside it — an unbounded runner is how one contact
receives a thousand emails overnight.

---

## D3 — Checkout recovery · L · `0049_checkout_sessions.sql`

`docs/specs/32-checkout-recovery.md`. **New table:** `checkout_sessions`.
Highest revenue per line in the release.

**Take the mechanism. Refuse the commission and the shared buyer network** —
§4.2 calls that a boundary, not a roadmap item.

**The abandoned Stripe session is the primary case — build it first.** Stripe is
Sailo's priority rail and the US/EU markets are where it runs; a card checkout
that was opened and never paid is the highest-value recoverable thing on the
platform, and the spec is written for it.

> ### Then recover the chat handoff, which nobody else can
>
> On the chat rails there is no session: *"the order is persisted first, then the
> buyer is handed off. The seller keeps the lead even if the handoff never
> completes."*
>
> **That already-persisted order is recoverable and nobody is recovering it.** A
> buyer handed to WhatsApp who never sent the message is a complete order row —
> basket, contact, everything — sitting unread. It costs little once the card
> half exists, because the follow-up machinery is the same, and **no competitor
> can build it, because no competitor persists an order before the money.**

**Decision B was decided for this endpoint:** session-create is a **public write
on every checkout view** and **fails closed**. Read `verdict.reason` — an outage
refusal is not an answer about the session.

**Consent is the part to get right** (§"Consent"). An abandoned checkout is not
a marketing opt-in: one nudge about *this* order is transactional; a second, or
anything about other products, is marketing and needs consent.

Money path: **scenario coverage, not unit coverage.**

---

## D4 — Integration scenarios · L · `0050_integration_scenarios.sql`

`docs/specs/31-integration-scenarios.md`. **New table:** `integration_apps`.

**Shares D2's runner and its `automations` table. Do not build a second
runner** — a parallel execution path is two schedulers, two retry policies and
two ways to send the same email twice.

Actions are generic and **the app-directory refusal stands** (§4). Outbound
webhooks already ship (spec 16) and are the seam to extend.

---

## D5 — Analytics expansion · M · `0051_pixels.sql`

`docs/specs/42-analytics-expansion.md`. Three more pixels, four metric tiles,
share links, checkout link vocabulary.

**Sequenced last so no tile ships always-zero** — the four tiles read D2's
`automation_runs`, D3's `checkout_sessions` and Wave E's lead kind. An
always-zero tile reads as a broken product.

Each new pixel goes through spec 09's **three gates** or it does not ship:
format validation (an unvalidated id is script injection in a `<script>` src),
the consent gate, and a CSP entry added **only when that pixel is configured** —
a blanket allowlist undoes spec 09. DataFast is **refused**: a named third-party
vendor in our settings is an endorsement and a support surface.

**Share links are the most dangerous thing in this wave** — a public URL
rendering a shop's revenue. The spec's rules are not negotiable: hashed token,
**required** expiry (30 days default, 90 max), **one metric and one fixed range
per token**, aggregates only, rate-limited, `noindex`, revocable, Business plan.

**Checkout link vocabulary:** `?coupon=` **prefills and never auto-applies** —
auto-applying makes every coupon guess free and turns the storefront into a
discount oracle. **No `?price=`**: a price in a URL is a price from the browser,
and *the server re-prices everything* is the invariant the checkout rests on.
`?qty=` clamps and **says so**.

---

## Done when

A WhatsApp buyer is a first-class contact; flows send on all four triggers; the
twelve lifecycle rungs are untouched; the order that was never sent gets one
nudge; no tile reads zero because its source does not exist; and no link
parameter can change a price.

---

## Non-negotiables

Read first: `docs/specs/README.md` (the ten rules) and
`docs/specs/GAP-2026-08-easytools.md` §4 (the refusals, which stand — no page
builder, no buyer network, no tax service, no per-seller sending domains, no
three-level funnels, no named themes). Then your specs, in full.

`docs/specs/RESHAPE-2026-08.md` is the analysis of why each spec was questioned
and what its smaller version looks like. **The full set is being built** — but
if something in your spec reads as a subsystem rather than a feature, that
document is where the argument for the smaller shape lives. Sailo is *"one template, no checkout to
configure"* and a seller is live in about three minutes — every screen you add
has to earn its place against that.

**The market is the US and the EU, and Stripe is the priority rail.** The chat
and manual rails exist and matter, but a feature that only pays off away from
Stripe is not the priority.

**Wave 0 is done and in the tree:** the chargeback suite runs again (it had been
failing to *load*, reporting "no tests"), spec 44 has landed, and Decisions A
and B are answered and built.

## Environment

```bash
nvm use 22.22.1     # node 20.10 breaks vitest at startup — non-negotiable
```

Scenario suites run against the **Neon dev branch**, not the container `up.sh`
starts. Apply your migration to that branch too:

```bash
npx dotenv -e .env.local.test -- \
  npx vitest run --config vitest.scenarios.mts e2e/scenarios/<yours>.scenario.ts
```

## The loop

**While working:** your package's `npx tsc --noEmit` and the one test file you
touched. Nothing more — a full `turbo test` takes minutes and tells you nothing
extra until you are ready to commit.

**Before a commit,** all of it:

```bash
npx tsc --noEmit && npx vitest run
./e2e/scenarios/up.sh && npx vitest run --config vitest.scenarios.mts
npm run build && npx oxlint
DATABASE_URL=postgres://k:k@localhost/k npx knip
npm run check:i18n
```

Plus **render it and read the visible text** (every RSC payload embeds the error
boundary's copy, so grepping for "something went wrong" matches healthy pages
too), and **verify in a browser** with `.env.local.test` — never `.env.local`,
which is production.

## Strings

Add English keys to `packages/i18n/src/{dictionaries,admin}/en.ts`, then
`npm run i18n:fill` (needs `ANTHROPIC_API_KEY`) or
`npm run i18n:fill -- --from batch.json`.

**Never hand-edit the 34 locale files.** A storefront key missing from any
locale is a compile error. Money sections (checkout, cart, rails, invoice,
billing, membership, download) are never machine-written.

## Rules you will be judged on

- **Claims are conditional UPDATEs** with the ceiling in the WHERE, never a read
  then a write. Webhooks idempotent and ownership-checked. Ledgers append. Order
  *lines*, not headers. Blank ≠ zero.
- **The six recurring bug shapes:** half-updated function pairs, a guard at one
  sink and not its twin, check-then-act, header-vs-lines, blank-vs-zero,
  throttled-as-no.
- **Every public route carries a ceiling.** Decision B is built — pass
  `{ onOutage: "closed" }` on public writes, anything spending money or quota,
  and anything whose answer says whether something exists. Read
  `verdict.reason`: a fail-closed refusal is **not** an answer about the
  request. Worked example: `COUPON_MESSAGES.unavailable` in
  `packages/core/src/money/pricing.ts`.
- **No response may be an existence oracle.** The same sentence whatever it
  found.
- **Plan gating** through `packages/core/src/shop/plans.ts`. No silent caps —
  clamped output says so.
- **Public storefront pages** are `"use cache"` + `cacheTag(shopTag(id))`; any
  write that changes what they show revalidates the tag.
- **Every seller-supplied URL** through the SSRF guard **at the write**, with the
  `lookup` hook rather than resolve-then-fetch.
- **Money-path changes need scenario coverage**, not unit coverage. That is
  where four defects were found last time, by writing them.
- **New columns on `products` are nullable or defaulted**, following
  `apps/web/drizzle/0034_product_kinds.sql`, so an existing catalogue reads and
  sells identically the moment your migration lands.

## Staging

Check `git status` first. **Stage explicit paths. Never `git add -A`.** Other
agents are in this tree and there is unrelated in-flight work in it.
