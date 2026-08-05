# Sailo

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
products and prices in Stripe and print the price ids. For local webhooks:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Without `STRIPE_SECRET_KEY` every shop stays on Free and the billing page says
so, rather than breaking.

Without `RESEND_API_KEY` the app runs fine and simply skips emails — a failed or
unconfigured send is logged and never blocks an order. The from-address domain
must be verified in Resend.

`NEXT_PUBLIC_APP_URL` is used to build the product links embedded in outgoing
WhatsApp messages — set it to the real origin in production.

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

## Routes

```
/                     Landing page
/signup, /login       Auth
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
/admin/settings/data      CSV import and export
/[handle]/affiliate   Public referral page (when enabled)
/invoice/[token]      Public invoice (HTML)
/invoice/[token]/pdf  Public invoice (PDF download)
```

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

There is no card checkout. Sellers switch on any combination of rails and the
buyer picks one:

| Rail | Kind | What happens |
|---|---|---|
| WhatsApp | chat handoff | `wa.me` deep link, order pre-filled |
| Telegram | chat handoff | `t.me` deep link, order pre-filled |
| Instagram DM | chat handoff | `ig.me` link (Instagram can't pre-fill) |
| Email | chat handoff | `mailto:` with the order written out |
| Phone | chat handoff | `tel:` link |
| Bank transfer | manual | Account details shown, buyer submits a reference |
| Cash on delivery | manual | Buyer pays on arrival |

Every rail follows the same rule: **the order is persisted first**, then the
buyer is handed off. The seller keeps the lead even if the handoff never
completes.

Manual rails require an email or phone number so the seller can follow up; chat
rails don't, because the conversation itself is the contact. A rail only appears
to buyers when it is both enabled *and* fully configured — a half-set-up option
is hidden rather than shown broken.

Card checkout (Stripe, Paystack, PayPal — connected by the seller, money going
straight to them) is the next step. Stripe reaches only 46 countries, which is
why the chat and manual rails come first.

## Data model

`shops` (one per user) → `categories`, `products` → `product_images`, `reviews`,
plus `payment_methods` and `delivery_methods` (the checkout rails), `clients`
(buyers), `coupons`, `affiliates` and `invoices`.

`orders` link to a client but also snapshot the customer and product details, so
a record stays truthful after a client edits their profile or a product is
deleted. Clients are matched on email or phone, so repeat buyers accumulate
history instead of creating duplicates; an order that collects no address never
blanks an address already on file.

`visits` holds pageview analytics. BetterAuth owns `user`, `session`, `account`
and `verification`.

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

Entitlements live in `lib/plans.ts` and are enforced **inside server actions**,
not just hidden in the UI. Downgrading never deletes anything: existing products,
coupons and affiliates keep working, you simply can't create more.

`past_due` deliberately keeps paid features — Stripe retries a failed renewal for
days, and taking a shop offline mid-sale over a card blip is worse than carrying
the risk.

## Not built yet

- Card checkout via seller-owned gateways. The Business tier gates it, but the
  rail itself isn't built — that's the next piece of work.
- Regional pricing. Flat USD today; localised pricing lifts conversion sharply
  in the emerging markets this is aimed at.
- Multi-item carts — an order is currently one product with a quantity.
- Custom domains, multiple shops per user, digital file delivery, bot filtering
  on visit tracking.
