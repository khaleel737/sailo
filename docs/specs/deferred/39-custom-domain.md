> **Refused, 2026-08-19. Not deferred — refused.** The owner's decision, in
> their own words: *"Remove custom domains, we will never add it, it will
> always be sailo.store/store-name."*
>
> A shop's address is `sailo.store/<handle>` and stays that way. Everything
> below is kept as the analysis — it is an accurate account of what the feature
> would have cost, and the three things it names as the ones that would bite
> (cookie scope, fixed-origin checks, a per-domain CSP) are the reasons it is
> a piece of infrastructure rather than a feature. `RESHAPE-2026-08.md` had
> already cut it on those grounds; this makes it permanent.
>
> **Do not pick this up.** A build was started against it and backed out the
> same day: `drizzle/0038_custom_domains.sql` is a tombstone explaining why its
> number cannot be reused, and nothing else survives.

# 39 — Custom domain

**Priority:** P2 · **Effort:** M · **Depends on:** nothing · **Blocks:** nothing

## What

A seller points `shop.theirdomain.com` — or the apex — at their Sailo
storefront and checkout, and the old `sailo.store/[handle]` links keep working.
Reference: Easytools Store settings → Custom domain, which is one field, one
"include www" checkbox, and a DNS instruction.

`customDomain` matches **0 files** in this tree today. This is table stakes for
a paid plan and it is entirely absent.

## Data model (migration, production first)

`drizzle/NNNN_custom_domains.sql`.

```
shop_domains  id, shop_id → shops(cascade),
              hostname text not null,          -- lowercased, punycode
              include_www boolean default false,
              status text default 'pending',
                -- pending | verifying | active | error | removed
              verification_token text not null,
              verified_at, last_checked_at,
              last_error text,
              is_primary boolean default true,
              created_at, updated_at
              unique (hostname) WHERE status <> 'removed'
              idx (shop_id)
```

`unique (hostname)` **globally**, not per shop: a hostname resolves to exactly
one storefront and two shops claiming one is the bug that serves the wrong
shop's products. Partial on `status <> 'removed'` so a released domain can be
re-claimed.

No column on `shops`. A shop may want an apex plus `www` plus a legacy domain
it is migrating from, and `is_primary` picks which one canonical URLs use.

## Behaviour

**Adding.** One field. Validate: a registrable hostname, punycode-encoded, not
a public suffix, not any `sailo.store` subdomain, not a hostname already
claimed. Store a verification token.

**Verification.** Two things must both be true and they fail differently, so
report them separately:

1. **Ownership** — a `TXT` record at `_sailo-verify.<host>` equal to the token.
2. **Routing** — the A/CNAME record resolves to our edge.

Poll on a cron with backoff, and on demand from a button. `last_error` carries
which of the two failed, in words a seller can act on. "Verification failed" is
the least useful string in SaaS.

**Certificates and routing** are the platform's job (Vercel domains API on the
project). The panel's contract is: hand the hostname to the platform, record
what it says, poll until active. Do **not** re-implement ACME.

**Serving.** Middleware resolves the request hostname to a shop and rewrites to
the existing `[handle]` tree. Rules:

- `sailo.store/[handle]` **keeps working for ever** — theirs promises "old links
  will stay active" and so must ours; a seller's printed QR codes and every
  affiliate link in existence point at it.
- With an active primary domain, canonical URLs, `sitemap.ts`, OG image URLs,
  the WhatsApp message links (`NEXT_PUBLIC_APP_URL`) and every email link use
  it. A canonical tag that disagrees with the served host splits the SEO the
  domain was bought for.
- The handle path emits `rel=canonical` pointing at the custom domain. **Not** a
  redirect: an existing outbound link must not change destination, and a
  redirect on a checkout URL breaks payment returns.

**Removal** sets `removed`, releases the platform binding, and reverts canonical
URLs the same request.

## The parts that will go wrong

- **Cookie scope.** `BETTER_AUTH_URL`, the session cookie and the checkout
  visitor cookie (spec 32) are all bound to a host. The seller admin stays on
  `sailo.store` and **only the storefront and checkout** serve from a custom
  domain — a session cookie issued to a seller-controlled hostname is an auth
  surface handed to a third party. Say this in the code, load-bearingly.
- **CSRF and origin checks.** Anything server-side that compares an `Origin` or
  `Referer` against a fixed origin will refuse every custom-domain checkout.
  `packages/core/src/origin.ts` and the recent "publish the API origin" commit
  are where to look. Find every fixed-origin comparison before shipping.
- **CSP.** `frame-ancestors`, `form-action` and the pixel allowlists are built
  per response. They must be built from the *serving* host, not a constant.
- **The `"use cache"` keying.** Storefront pages are cached under
  `cacheTag(shopTag(shopId))`, which is host-independent and therefore correct —
  but anything embedding an absolute URL in cached output must key on the host
  too, or shop A's cached page can render shop B's domain. `PRODUCTION-PLAN.md`
  lists three caches that had silently stopped working and two that lied about
  plan changes; this is the same failure mode.
- **Route collision.** The handle-squatting test reads `src/app` off disk to
  stop a live route being claimed as a handle. A custom domain has the mirrored
  problem: `theirdomain.com/admin` must **not** reach the admin app. Middleware
  serves custom hostnames a storefront-only route table, and there is a test
  that asserts `/admin`, `/hq`, `/api/stripe/*` and `/dev` are unreachable there.
- **SSRF.** DNS verification resolves a seller-supplied hostname. Use the
  resolver, not `fetch`, and if any HTTP check is added it goes through
  `packages/webhooks/src/post.ts`'s `lookup` hook — the same hole spec 16 closed.

## Details that must not be missed

- **Plan gate:** Pro+, and a downgrade **deactivates** the domain rather than
  deleting it, reverting to the handle URL with the record retained so
  re-upgrading is one click.
- `include_www` provisions both hostnames as their checkbox does, and the panel
  says both A records are needed — theirs does, and it is the commonest support
  ticket in this feature.
- Rate-limit add and verify per shop. Domain verification is a DNS lookup
  amplifier.
- Sitemap and `robots.ts` must be per-host, and the handle host must not
  advertise a sitemap of URLs whose canonical is elsewhere.
- 35-locale strings: the settings card, DNS instructions, five status labels,
  two failure reasons.

## Testing

Unit: hostname validation (punycode, public-suffix refusal, `sailo.store`
refusal, case folding); the canonical-URL builder for handle host vs custom host
vs deactivated; the storefront-only route table.

Scenario: add → pending; TXT present but A wrong → error naming routing; both
right → active; a second shop claiming the hostname is refused; downgrade
deactivates and canonical reverts; removal releases the claim and it can be
re-added.

E2E, in a real browser against a test hostname: storefront renders; a checkout
completes end to end (this is the assertion that catches the origin and CSP
problems, and nothing cheaper will); `/admin` and `/hq` are unreachable; no
session cookie is set on the custom host.

## Done when

A seller adds a domain, is told precisely which record is wrong, gets a
certificate, sells from it, keeps every old link working, and no session cookie,
admin route or fixed-origin check has followed the storefront onto a hostname
somebody else controls.
