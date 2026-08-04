# Shopik

**Your bio link, but it's a shop.**

Shopik is as simple as a link-in-bio page — except the rows are your products.
Sellers upload what they sell (physical goods, digital downloads or services),
share one link, and take orders on WhatsApp. One template, no checkout to
configure, works in every country.

Demo shop (after seeding): `/demo`

## Why this shape

Every incumbent in this category optimises for *digital* products — courses,
coaching, ebooks. None of them ship a real product catalogue: no categories, no
filters, no search, no reviews. Everyone who *does* serve physical sellers went
heavy (Big Cartel, Dukaan, Shopier, Salla, Zid) — full store platforms with
checkout, shipping, inventory and tax.

Shopik sits in the empty middle: a catalogue page as simple as Linktree.

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

npm run db:push    # create tables
npm run db:seed    # optional: demo shop at /demo
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
```

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
/admin/orders         Order intents + status
/admin/clients        Buyers, grouped by contact
/admin/reviews        Review moderation
/admin/settings       Identity, appearance, socials, WhatsApp
```

## How ordering works

There is no checkout. When a buyer taps **Order**:

1. A sheet collects quantity, name, contact and an optional note.
2. The order is **persisted first** as an intent — so the seller keeps the lead
   even if the buyer never sends the message.
3. The buyer is handed a `wa.me` deep link with the order details pre-filled.

If a seller hasn't set a WhatsApp number the order is still recorded, and the
buyer sees a confirmation instead.

## Data model

`shops` (one per user) → `categories`, `products` → `product_images`, `reviews`.
Plus `orders` (intents, carrying a product snapshot so records survive product
deletion) and `visits` (pageview analytics). BetterAuth owns `user`, `session`,
`account` and `verification`.

## Not built yet

- Payments — deliberate. WhatsApp ordering dodges merchant-of-record liability
  and country restrictions, which is what makes a global v1 possible.
- Custom domains, multiple shops per user, digital file delivery, email
  notifications, bot filtering on visit tracking.
