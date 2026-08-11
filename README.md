# Sailo

[github.com/khaleel737/sailo](https://github.com/khaleel737/sailo) · [sailo.store](https://sailo.store)

**Your bio link, but it's a shop.**

Sailo is as simple as a link-in-bio page — except the rows are your products.
Sellers upload what they sell (physical goods, digital downloads or services),
share one link, and take orders on WhatsApp. One template, no checkout to
configure, works in every country.

Showcase shops (after seeding): `/demo` (ceramics), `/forno` (pizzeria),
`/lumi` (nail bar), `/serene` (massage rooms), `/inkwell` (ebooks). The landing
page links to all five and shows screenshots taken from those very pages.

## Why this shape

Every incumbent in this category optimises for *digital* products — courses,
coaching, ebooks. None of them ship a real product catalogue: no categories, no
filters, no search, no reviews. Everyone who *does* serve physical sellers went
heavy (Big Cartel, Dukaan, Shopier, Salla, Zid) — full store platforms with
checkout, shipping, inventory and tax.

Sailo sits in the empty middle: a catalogue page as simple as Linktree.

Ordering over WhatsApp is what makes it global — no Stripe onboarding, no
merchant-of-record liability, no country restrictions, no seller KYC. A seller
anywhere is live in about three minutes.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Database | Neon Postgres (via Vercel Marketplace) |
| ORM | Drizzle |
| Auth | BetterAuth (email + password) |
| Images | Vercel Blob |
| Icons | lucide-react |

## Getting started

```bash
npm install

# Pull the Neon + Blob credentials from the linked Vercel project
vercel env pull .env.local

npm run db:push          # create tables
npm run db:seed          # optional: the /demo shop
npm run db:seed:demos    # optional: the four other showcase shops
npm run dev
```

Then open http://localhost:3000.

### Environment

`vercel env pull` provides `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN`. Add these
yourself:

```bash
BETTER_AUTH_SECRET=      # openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Email (optional — order, shipping and refund notifications)
RESEND_API_KEY=
SAILO_FROM_EMAIL="Sailo <orders@yourdomain.com>"

# Bulk email ceilings (optional — sensible defaults if unset)
BROADCAST_DAILY_CEILING=   # a seller's marketing to their buyers, platform-wide
LIFECYCLE_DAILY_CEILING=   # Sailo's own onboarding email to sellers

# Billing (optional — subscriptions)
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PRO_MONTHLY=
STRIPE_PRICE_PRO_YEARLY=
STRIPE_PRICE_BUSINESS_MONTHLY=
STRIPE_PRICE_BUSINESS_YEARLY=
```

Run `npx dotenv -e .env.local -- npx tsx scripts/stripe-setup.ts` to create the
products and prices in Stripe and print the price ids. See **Testing** below
for forwarding webhooks locally.

Two webhook secrets, not one. Stripe delivers connected-account events — every
card sale a buyer makes — only to an endpoint registered *for Connect*, and
that registration has its own signing secret. An integration with only the
ordinary endpoint records no payments at all:

```bash
STRIPE_WEBHOOK_SECRET=          # /api/stripe/webhook — sellers paying us
STRIPE_CONNECT_WEBHOOK_SECRET=  # /api/stripe/connect/webhook — buyers paying sellers
```

Without `STRIPE_SECRET_KEY` every shop stays on Free and the billing page says
so, rather than breaking.

Without `RESEND_API_KEY` the app runs fine and simply skips emails — a failed or
unconfigured send is logged and never blocks an order. The from-address domain
must be verified in Resend, and so must every address on it: `orders@`,
`accounts@`, `partners@`, `support@` and `marketing@`.

`marketing@` is deliberately its own address. Mailbox providers score
reputation per sending address as well as per domain, and lifecycle mail is the
traffic that earns complaints — keeping it off `accounts@` means a bad campaign
cannot land a seller's password reset in spam. Unsubscribe links are signed with
a key *derived* from `BETTER_AUTH_SECRET`, so no new secret is needed; without
that variable the lifecycle pass refuses to send at all rather than mailing a
dead link.

`NEXT_PUBLIC_APP_URL` is used to build the product links embedded in outgoing
WhatsApp messages — set it to the real origin in production.

## Testing

Three suites, and they cover different things on purpose.

```bash
npm run typecheck                                # tsc, separately — vitest does not typecheck
npm test                                         # 1,217 unit tests
npx playwright test e2e/                         # 34 browser tests
npm run lint                                     # oxlint, zero errors expected
npm run build                                    # read the exit code, not the output
```

### The scenario suite — the money path, against a real database

Until recently no test in this repo had ever placed an order, because the only
database the app could reach was production's. Writing one would have taken
real stock and claimed a real invoice number out of a sequence a tax authority
expects unbroken.

`scripts/scenarios/up.sh` gives it somewhere safe to write: a throwaway
Postgres behind a local Neon HTTP proxy. The proxy is the load-bearing part —
the app speaks Neon's HTTP protocol and a plain container cannot answer it.

```bash
./scripts/scenarios/up.sh                        # needs Docker
npx vitest run --config vitest.scenarios.mts     # 50 scenarios
docker rm -f sailo-test-db sailo-neon-proxy      # when you are done
```

`src/db/index.ts` points the driver at the proxy **only when `DATABASE_URL`
names localhost** — keyed on the hostname rather than a flag, because a flag
can be set by mistake in production and a hostname cannot lie about where the
database is. Both scenario suites refuse to start otherwise.

Covered: who may sell, what an order costs, stock, digital delivery, coupons,
bookings, cancellation, abandonment, and settlement — including the races a
single-threaded test cannot see (two buyers, one unit; two buyers, one coupon;
two buyers, one appointment).

### Testing webhooks with the Stripe CLI

```bash
./scripts/scenarios/up.sh
npx dotenv -e .env.local.test -- npx next dev -p 3100

stripe listen \
  --forward-to         http://localhost:3100/api/stripe/webhook \
  --forward-connect-to http://localhost:3100/api/stripe/connect/webhook

stripe trigger checkout.session.completed
```

Put the secret `stripe listen` prints into **both** `STRIPE_WEBHOOK_SECRET` and
`STRIPE_CONNECT_WEBHOOK_SECRET` in `.env.local.test` — the CLI signs everything
it forwards with the one secret, while production uses two.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run db:push` | Push the Drizzle schema to Neon |
| `npm run db:studio` | Drizzle Studio |
| `npm run db:seed` | Reset and seed the `/demo` shop |
| `npm run db:seed:demos` | Reset and seed `/forno`, `/lumi`, `/serene`, `/inkwell` |
| `npm run shots` | Re-capture the landing page's storefront screenshots |
| `npm run check:i18n` | Translation coverage for the storefront, landing page and admin |
| `npm run typecheck` | `tsc --noEmit`. Run it separately — vitest does not typecheck |
| `npm test` | Unit tests |
| `npm run test:e2e` | Playwright |
| `npm run verify` | All of the above, in order |
| `./scripts/scenarios/up.sh` | Throwaway Postgres + Neon proxy for the scenario suite |

## Routes

```
/                     Landing page
/signup, /login       Auth
/verify-2fa           Second factor, when the account has one
/onboarding           Claim a handle, create the shop
/[handle]             THE TEMPLATE — public shop
/[handle]/p/[slug]    Product detail + reviews
/admin                Overview: visits, orders, products
/admin/products       Product CRUD with image upload
/admin/categories     Category management
/admin/orders         Orders, payment status, delivery, invoice links
/admin/clients        Buyers with lifetime totals
/admin/clients/[id]   Client profile, address, notes, full order history
/admin/coupons        Discount codes
/admin/affiliates     Referral programme, rates, links, commission owed
/admin/payments       Turn payment rails on/off and configure them
/admin/delivery       Shipping and collection options
/admin/reviews        Review moderation
/admin/settings       Shop details, appearance, socials, address collection
/admin/settings/billing   Plan and billing
/admin/settings/security  Two-factor, login sessions, account deletion
/admin/settings/data      CSV import and export
/[handle]/affiliate   Public referral page (when enabled)
/r/[code]             Refer-a-creator link — sets the cookie, sends them to signup
/invoice/[token]      Public invoice (HTML)
/invoice/[token]/pdf  Public invoice (PDF download)
/download/[token]     Digital delivery — the buyer's files
/partner              Affiliate portal sign-in
/hq                   Sailo's own back office (staff allowlist, magic link only)
/hq/referrals         What we owe creators for the creators they brought us
```

### API routes

```
/api/stripe/webhook           Sellers paying us — subscriptions
/api/stripe/connect/webhook   Buyers paying sellers — every card sale
/api/cron/{rollup,sitemap,sweep,reminders,broadcasts,lifecycle}
                              Bearer-secret only, scheduled in vercel.json
/api/unsubscribe/[token]      One-click out of a shop's marketing (RFC 8058)
/api/unsubscribe/marketing/[token]  One-click out of Sailo's own
/api/download/[token]/[fileId]     Tokened file delivery
/api/export/[type]            Seller CSV export
/api/booking/[productId]      Free appointment slots
/api/track, /api/referral     Public beacons
/api/upload                   Seller image and file upload
```

Every route carries a ceiling or a credential: a rate limit, a bearer secret, a
Stripe signature, or a session guard. There is deliberately no CORS
configuration anywhere — browsers may send cross-origin requests but cannot
read any response, and server actions are covered by Next's same-origin check.

## Delivery, discounts and commission

**Delivery** options are rows, not fixed types — a shop can offer "Standard",
"Express", "International" and a pickup point all at once, each with its own
fee and free-over threshold. Only physical products ask; digital goods and
services skip it. Collection options never ask for an address.

Orders reference the chosen rate by id *and* snapshot its name and fee, so
editing a rate later never rewrites history.

**Fulfilment**: shipping orders take a carrier, tracking number and link. Saving
them moves the order to `shipped` and emails the buyer. Order status runs
`new → confirmed → shipped → completed`, with `cancelled` and `refunded`.

**Refunds** record an amount (defaulting to the full total, capped at it) and a
reason. They come straight off net revenue while leaving gross untouched, and
the buyer is emailed. A full refund flips both order and payment status.

**Coupons** are percent or fixed, with an optional minimum spend, usage cap and
expiry. A discount can never exceed the subtotal, so a total can't go negative.

**Affiliates** earn a share of what they refer. Each has a code used as
`?ref=CODE`, with a per-affiliate rate overriding the shop default. Attribution
is last-touch, stored for 30 days. Commission is charged on goods **after
discount** and never on the delivery fee.

Buyers who leave an email are offered their own referral link right after
ordering — the moment they've just demonstrated they like the shop. Sellers can
also open a public signup page, where applications wait for approval; buyer
referrals go live immediately.

Money on an order always satisfies:

```
total = subtotal − discount + delivery
```

Percentages are stored in basis points (1000 = 10%) so fractional rates survive
a round trip. The order sheet quotes totals from the same `computeTotals` the
order uses, so the quote can't drift from what's charged.

**Invoices** are issued automatically on every order with a per-shop sequential
number, claimed atomically so concurrent orders can't collide. Each has an
unguessable token URL serving both an HTML view and a real generated
`application/pdf` download at `/invoice/<token>/pdf` — linked from the admin,
the invoice page and the buyer's confirmation.

## Import and export

CSV in and out, using Shopify's column names so files move between the two
without hand-editing: UTF-8 with a BOM, no currency symbols, `Handle` as the
product key.

Exports cover products, orders and customers. Imports cover **products and
customers only** — orders are export-only, the same restriction Shopify has,
because importing an order means inventing payment and fulfilment history.

Two details worth knowing:

- Import is **two-step**. The first submit is a dry run reporting what would
  happen and the per-row problems; nothing is written until you confirm.
- Fields absent from a file never blank stored values. Re-importing a partial
  customer list won't wipe addresses it didn't carry.

Exported fields beginning `=`, `+`, `-` or `@` are prefixed with a quote so a
product title can't execute as a formula when the file opens in Excel.

## How ordering works

Sellers switch on any combination of rails and the buyer picks one:

| Rail | Kind | What happens |
|---|---|---|
| WhatsApp | chat handoff | `wa.me` deep link, order pre-filled |
| Telegram | chat handoff | `t.me` deep link, order pre-filled |
| Instagram DM | chat handoff | `ig.me` link (Instagram can't pre-fill) |
| Email | chat handoff | `mailto:` with the order written out |
| Phone | chat handoff | `tel:` link |
| Bank transfer | manual | Account details shown, buyer submits a reference |
| Cash on delivery | manual | Buyer pays on arrival |
| Card | Stripe Connect | Direct charge on the seller's own account; money never touches ours |

Every rail follows the same rule: **the order is persisted first**, then the
buyer is handed off. The seller keeps the lead even if the handoff never
completes.

Manual rails require an email or phone number so the seller can follow up; chat
rails don't, because the conversation itself is the contact. A rail only appears
to buyers when it is both enabled *and* fully configured — a half-set-up option
is hidden rather than shown broken.

**Card is a direct charge on the seller's own Stripe account**, so the money
goes to them and never sits with us. It is a Business-plan feature and a
separate webhook registration — Stripe delivers connected-account events only
to an endpoint registered for Connect, which is why there are two routes.

The chat and manual rails still come first, and that is the point of the
product rather than a limitation: Stripe reaches 46 countries, and a seller
anywhere can be taking orders on WhatsApp in three minutes with no onboarding,
no KYC and no merchant-of-record liability.

## Data model

`shops` (one per user) → `categories`, `products` → `product_images`, `reviews`,
plus `payment_methods` and `delivery_methods` (the checkout rails), `clients`
(buyers), `coupons`, `affiliates` and `invoices`.

`orders` link to a client but also snapshot the customer and product details, so
a record stays truthful after a client edits their profile or a product is
deleted. Clients are matched on email or phone, so repeat buyers accumulate
history instead of creating duplicates; an order that collects no address never
blanks an address already on file.

`visits` holds pageview analytics. BetterAuth owns `user`, `session`, `account`,
`verification` and `two_factor`.

## Security and account

**Two-factor** is TOTP, from BetterAuth's own plugin — the secret and the backup
codes are encrypted with `BETTER_AUTH_SECRET`, and nothing is switched on until
a code has been verified against the freshly enrolled secret. Enabling or
disabling it kills every other session and emails the account, because a silent
2FA change is what an account thief wants. Magic links deliberately skip the
second factor: `sendMagicLink` only ever mails a staff address, and a staff
account holds no password, so the two doors admit disjoint sets of people. That
argument is written where the two plugins meet in `lib/auth.ts` — if magic links
are ever opened to sellers, it stops holding.

**Login sessions** list every signed-in device with its location, browser and
sign-in time. Location comes from Vercel's geo headers, read once at session
creation and stored, since the headers describe only the current request; rows
from before that shipped show nothing rather than a guess. Terminating is
immediate — there is no session cookie cache in front of it, which is the one
way this feature could have silently lied.

**Deleting an account** anonymises the ledger rather than dropping it. Orders
and invoices document real money and a per-shop invoice sequence a tax
authority expects unbroken, so the `shops` row survives as their retention
container: tombstoned, unpublished, handle released, seller details overwritten.
Everything else — catalogue, files, coupons, bank details, sessions, the 2FA
secret — is deleted outright, and the platform subscription is cancelled at
Stripe first so nobody keeps being charged for a store that is gone. It refuses
while a paid order is undelivered: deleting mid-obligation is seller fraud
tooling. Buyers keep their invoices and their downloads.

**Seller notifications** email the seller when an order lands, a booking is
requested, or a buyer reports a manual payment. Exactly one email per order —
the manual rails send at checkout, card sends when the webhook settles, on the
same discriminator the buyer's confirmation uses. Per-event switches live in
Settings, stored as the *off* ones so a new event type ships on for everyone
without a backfill.

## Plans

| | Free | Pro — $9.99/mo | Business — $19.99/mo |
|---|---|---|---|
| Products | 20 | 250 | Unlimited |
| Chat ordering + bank transfer + COD | ✓ | ✓ | ✓ |
| Delivery, reviews, filters, PDF invoices | ✓ | ✓ | ✓ |
| Import products and customers | ✓ | ✓ | ✓ |
| Sailo badge removed | — | ✓ | ✓ |
| CSV export | — | ✓ | ✓ |
| Card payments (seller's own gateway) | — | — | ✓ |
| Coupons and referrals | — | — | ✓ |
| Analytics window | 30 days | 1 year | 3 years |

Yearly billing is ~20% off. Sailo takes **no cut of any sale** on any plan.

Free is deliberately enough to take real orders — a paywall before the first
sale converts nobody, and every free shop carries the badge, so free shops are
distribution. Pro is "look professional and grow"; Business is "the tools that
make more money".

**Import is free on every plan.** It reduces the cost of switching to Sailo,
so putting it behind a paywall would be self-defeating.

**Refer-a-creator is free on every plan too**, for the same reason turned
around: it is Sailo's own acquisition channel, and charging a seller for the
privilege of bringing us a customer would be an odd way to run it. Every
seller gets a `/r/<code>` link and keeps 20% of what the creator they referred
pays us, every month, for as long as that subscription runs — appended to an
append-only ledger by the `invoice.paid` webhook, settled by hand from
`/hq/referrals` above a $25 minimum. Distinct from the *product* affiliates
above, which are a seller paying someone to sell their products; this is us
paying a seller. See `lib/creator-referrals/`.

Entitlements live in `lib/plans.ts` and are enforced **inside server actions**,
not just hidden in the UI. Downgrading never deletes anything: existing products,
coupons and affiliates keep working, you simply can't create more.

`past_due` deliberately keeps paid features — Stripe retries a failed renewal for
days, and taking a shop offline mid-sale over a card blip is worse than carrying
the risk.

## Deploying

Every push to `main` deploys to https://sailo.store. Before pushing:

```bash
npm run typecheck && npm test && npm run build && npm run lint
```

**A schema change is not shipped until its migration has run**, and in that
order. Drizzle selects every column its schema declares, so one column the
database has never heard of breaks every read of that table — and the build,
the tests and the types are all green either way, because none of the three
connects to a database. Three columns once went out ahead of their migration
and took every shop page down.

```bash
# Write it by hand for an additive change; db:push diffs the whole schema.
# Apply it, confirm the column is really there, and only then push the code.
npx dotenv -e .env.local -- npx tsx -e "…"
```

And `curl | grep` is not a health check: every RSC payload embeds the error
boundary's copy, so grepping a page for "something went wrong" matches the
healthy ones too. Render it and read the visible text.

## Not built yet

- Regional pricing. Flat USD today; localised pricing lifts conversion sharply
  in the emerging markets this is aimed at.
- Custom domains, multiple shops per user, bot filtering on visit tracking.
- Paystack and PayPal rails. Card is Stripe Connect only, which leaves out the
  markets Stripe does not reach — the reason the chat rails matter.
- The 90-day sweep for a deleted seller's product files. Deletion removes their
  images at once and keeps the files, because buyers who paid for a download
  still hold live tokens; the cron that finally clears them is a TODO in
  `api/cron/sweep`.

Shipped since this list was last written: card checkout on Stripe Connect,
multi-item carts (up to 50 lines), digital file delivery with tokened
downloads, appointment booking for services, the security tab — two-factor
sign-in, login sessions, self-serve account deletion and seller-facing order
notifications — and the growth pair: the store-setup checklist on the
dashboard, and refer-a-creator end to end.
