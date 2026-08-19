# 48 — Digital product depth: code pools, licence keys, files per variant, versions

**Priority:** P1 · **Effort:** L · **Depends on:** nothing · **Blocks:** nothing

## What

Four gaps in the `digital` kind. The first is a real defect, not a missing
feature.

## 1. `digital_delivery = 'code'` gives every buyer the same code

`0034_product_kinds.sql` added three delivery modes and described them well:

> `digital_link_url` — Where the buyer goes, under 'link'.
> `digital_access_details` — The key or joining instructions, under 'code'.

Both are **single columns on `products`**. So a seller selling 200 licence keys,
200 Notion duplicate links, or 200 one-time invite URLs types one value and every
buyer receives it. For a Discord invite or a course-platform link that is correct
and intended. For a licence key, a redemption code, a one-seat invite or a
software serial it is the product being given away — the first buyer can share
one string and nobody else needs to pay.

This is the gap to close first, and it is the one the seller notices as
"I cannot sell licence keys here."

### Data model

```
product_codes   id, product_id → products(cascade),
                variant_id → product_variants(set null),
                code text not null,
                claimed_by_order_id → orders(set null),
                claimed_at timestamp,
                revoked_at timestamp,
                created_at
                unique (product_id, code)
                idx (product_id, variant_id) WHERE claimed_at IS NULL

products
  code_source text      -- NULL (shared, today's behaviour) | 'pool' | 'generated'
  code_pattern text     -- for 'generated', e.g. SAILO-XXXX-XXXX-XXXX
```

`code_source` defaulting NULL is what makes every existing product behave
exactly as it does today — the `0034` rule.

### The claim is the whole security content

A pool of codes is a pile of **bearer tokens**, and handing one out is spending
inventory. Every rule this repo already earned applies:

- **Claim in SQL, conditionally.** `UPDATE product_codes SET claimed_by_order_id
  = $1, claimed_at = now() WHERE id = (SELECT id FROM product_codes WHERE
  product_id = $2 AND claimed_at IS NULL AND revoked_at IS NULL ORDER BY id
  LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING code`. Never read-then-write: that
  is the check-then-act shape that ended a buyer's checkout on an error page in
  `upsertClient`, and here it would hand two buyers one key.
- **`SKIP LOCKED`**, so two concurrent checkouts take two different codes rather
  than one blocking on the other.
- **Claimed at release, not at checkout.** The code is spent when
  `downloadReleasedAt` is set, exactly as the file and the event join URL are —
  `0034` says both are "held behind `orders.download_released_at`… They are the
  whole good; handing one to an unpaid order gives the good away." An abandoned
  Stripe session must not burn a key, and roughly a third of them are abandoned.
- **The pool is stock.** An empty pool means the product cannot be sold. Wire it
  into the existing `unitsLeft` / `trackInventory` path rather than inventing a
  second sold-out concept, so the storefront, the checkout, `maxPerOrder` and
  spec 33's waitlist all work unchanged.
- **A refund revokes.** `revoked_at`, and the code is *not* returned to the pool
  — a key a buyer has already seen is spent whatever happens next. The seller is
  told the count so they can top up.
- **Never in a page payload.** An unclaimed code must not appear in any RSC
  payload, preview, OG image or CSV export of products. Only the buyer's own
  released delivery page and the order detail the seller owns.
- **Upload and generate.** CSV upload for keys minted elsewhere (the common
  case — Adobe-style serials, Steam keys); `code_pattern` for codes Sailo mints.
  Generated codes use the same CSPRNG path as `download_token` and `pass_code`,
  and must not collide with either: `admitAnyCode` in the ticketing path
  disambiguates a 10-character ticket from a 12-character pass **by arithmetic**,
  and there is a test that fails if anyone shortens one to match. A third code
  type must pick a length no existing folding can produce, and extend that test.

## 2. Licence keys with activations — the software seller's version

A code pool serves anyone handing out a string. A software seller needs the
string to be *checkable*. [Lemon Squeezy's model](https://docs.lemonsqueezy.com/api/license-api)
is the one to copy because it is the one integrators already know: a licence key
has an **activation limit** and a **licence length**, each activation creates an
*instance* with its own identifier, and instances are deactivated individually or
the key is disabled outright.

```
license_keys        id, product_id → products(cascade),
                    order_id → orders(set null),
                    client_id → clients(set null),
                    key text not null,
                    activation_limit integer,       -- NULL = unlimited
                    expires_at timestamp,           -- from licence length
                    status text default 'active',   -- active|disabled|expired
                    created_at
                    unique (key)

license_activations id, license_key_id → license_keys(cascade),
                    instance_name text, instance_identifier text not null,
                    ip text, user_agent text,
                    activated_at, deactivated_at
                    unique (license_key_id, instance_identifier)
```

`products` gains `license_enabled boolean`, `license_activation_limit integer`,
`license_days integer`.

### The public API — the risky surface

Three endpoints on `apps/api`, deliberately outside the authenticated v1 surface
because the seller's *software* calls them, not the seller:

```
POST /api/license/activate    { key, instance_name }  → { valid, instance_id, meta }
POST /api/license/validate    { key, instance_id? }   → { valid, expires_at, meta }
POST /api/license/deactivate  { key, instance_id }    → { deactivated }
```

- **No API key.** The licence key *is* the credential; requiring a seller's API
  key inside shipped software would put it in every customer's binary.
- **Therefore rate-limit hard, and keyed on the key**, not the IP — desktop
  software behind one office NAT is many machines. A guessing budget charges
  misses, not lookups (the coupon-enumeration rule), and the response for an
  unknown key and a disabled key must be **identical**: `{ valid: false }` with
  no reason. A distinguishable answer is a key-existence oracle.
- **Activation over the limit is a refusal, not an error.** `{ valid: false,
  reason: "activation_limit" }` only to a *known* key, because at that point the
  caller has already proven they hold it.
- Constant-time key comparison; keys stored hashed with a lookup prefix, the
  shape `door_passes` and `testimonial_requests` use.
- Never log the key. Log the prefix.
- Activation counts against `activation_limit` at the *instance* level, claimed
  conditionally like everything else.

Document it at `/docs/api` beside the REST surface — a licensing API nobody can
read is a licensing API nobody integrates.

## 3. Files per variant

`product_files.productId` exists; there is no `variantId`. So a product sold as
"PDF only / PDF + Figma / everything" delivers the same set to all three.
Easytools does this per variant (§`digital-downloads`) and their fallback rule is
the right one to copy: *"If you add a file to a product with more than one
variant, we will automatically assign it to each variant. When you override
settings for one variant, the others will still use the default assigned file."*

```
product_files
  variant_id → product_variants(set null)   -- NULL = the product default
```

Delivery resolves: files for the ordered variant if any exist, else the
product-level files. Nullable default means every existing product is unchanged.

**The download gate must not widen.** `/download/[token]/[fileId]` currently
checks the file belongs to the order's product. It must now also check the file
belongs to the *ordered variant or the product default* — otherwise buying the
cheap variant downloads the expensive one's files, which is the whole feature
inverted. That check is the test that matters most here.

## 4. File versions, and telling buyers about them

A seller who fixes a typo in an ebook or ships v2 of a template has no way to
say so, and no way to let past buyers re-download the new one. Today replacing a
file silently changes what an old order fetches, which is *usually* right and
occasionally wrong — a buyer who paid for v1 of a template being handed v3 with
breaking changes has a support problem.

```
product_files
  version text            -- seller's own label: "v2", "2026 edition"
  replaces_file_id uuid → product_files(set null)
  notify_buyers_at timestamp   -- claimed once, see below
```

- **Past buyers keep access to the current file**, which is what they expect and
  what already happens. Versioning is *labelling plus an announcement*, not a
  second entitlement model. Do not build per-order file pinning.
- "Notify buyers of the update" is a **claimed** send (`notify_buyers_at` set by
  conditional UPDATE) against the broadcast quota and suppression list — it is a
  bulk mail wearing a product feature's clothes, exactly as spec 33's waitlist
  notify is.
- The delivery page shows the version and the date, so a buyer can see they have
  the current one.

## Details that must not be missed

- **`digital_delivery = 'link'` gets pools too.** The user-facing case is a
  Notion duplicate link or a one-seat invite URL, which is a code that happens to
  be a URL. Same table, and `code` holds it. Validate as a URL and put it through
  the **existing SSRF/allowlist guard at the write** where it will be rendered as
  a link.
- **Download limits interact.** `downloadLimit` counts fetches; a code is not a
  fetch. Claiming a code must not consume a download allowance, and the refused-
  file bug (`PRODUCTION-PLAN.md` §2 item 14 — a refused legacy file burning an
  allowance per attempt) must not recur through the code path.
- **`download_events` is evidence** (spec 44/45). A code claim and a licence
  activation are both stronger evidence than a download — record them there or
  in the message log, with IP, because a `product_not_received` dispute on a
  licence is answered by "activated from this address on this date".
- **CSV export of the pool** for the seller, formula-escaped, claimed codes only
  — an export of unclaimed keys is the inventory leaving the building.
- Plan gate: code pools on Pro; the licensing API on Business.
- 35-locale strings: pool upload UI, sold-out copy, licence settings, the
  delivery page's code and version blocks, the update notification.

## Testing

Unit: claim SQL under concurrency (two callers, one code → two different codes,
never one twice); pool-exhaustion → `unitsLeft` zero; generated-code length
cannot be folded into a ticket or pass length (extend the existing test);
licence activation limit arithmetic; unknown vs disabled key produce byte-
identical responses; file resolution per variant with and without overrides.

Scenario: 3-code pool, 4 buyers → 3 succeed and the 4th sees sold out; an
abandoned card session burns no code; refund revokes and does not return it to
the pool; buying variant A cannot download variant B's file; activate to the
limit then refuse; deactivate frees a slot; a version notify sends once under two
ticks and respects suppression; an unclaimed code appears in no page payload or
export.

## Done when

A seller uploads 200 licence keys and each buyer gets exactly one, atomically;
software can activate, validate and deactivate against a rate-limited API that
leaks nothing about unknown keys; variant-specific files deliver only to the
variant that bought them; and a shared code still behaves exactly as it does
today for the sellers using it that way.
