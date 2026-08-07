# Sailo — threat model, payment and auth paths

First run, 2026-08-07. `HANDOFF.md` named this as the step skipped last time,
and as the reason a hand-rolled hardening pass still left nine bugs behind.

Scope: the paths where an untrusted party reaches money, goods or staff access
— `createOrderIntent`, `submitPaymentReference`, both Stripe webhook routes,
`releaseAbandonedCheckouts`, the `/hq` allowlist, and the download token flow.

---

## 1. Trust boundaries

| Party | How they arrive | What they can already do |
|---|---|---|
| **Anonymous buyer** | Public shop page | Place orders, reserve stock, quote a payment reference, redeem a download token |
| **Registered seller** | **Open signup** — no invite, no review | Create products, set file URLs, take card payments through their own Stripe account |
| **Stripe** | Two signed webhook endpoints | Move orders between payment states |
| **Sailo staff** | Email allowlist, no role column | Everything, across every shop |

The load-bearing fact for the finding below: **a seller is not a trusted party**.
Signup is open, so "authenticated seller" and "anyone" are the same set.

---

## 2. Entry points, inventoried

Unauthenticated server actions: `createOrderIntent`, `previewOrder`,
`submitPaymentReference`, `setLocale`, `applyAsAffiliate`.

API routes and their guards:

| Route | Guard |
|---|---|
| `stripe/webhook`, `stripe/connect/webhook` | Signature (`verifyEvent`) |
| `cron/{sweep,rollup,sitemap}` | `CRON_SECRET` |
| `upload`, `export/[type]` | `requireShop` |
| `hq/export/[type]` | `requireStaff` |
| `referral`, `track` | **None** — by design, both write only analytics |
| `download/[token]/[fileId]` | **Token is the credential** |
| `auth/[...all]` | BetterAuth |

---

## 3. Finding: server-side request forgery via a product file URL

**Severity: high. Fixed in this commit.**

### The trace

1. `syncFiles` (`lib/actions/products.ts`) accepted any file URL whose string
   matched `^https?://`. The host was never checked.
2. It is a **server action**, so the payload is whatever the client posts. The
   upload widget in the UI is not a gate — it is a suggestion.
3. `productFiles.url` is stored verbatim.
4. `GET /api/download/[token]/[fileId]` does `await fetch(file.url)` **on the
   server** and returns `upstream.body` directly to the caller.

So a stored string became a server-side request whose response was streamed
back to whoever asked for it.

### The chain

1. Sign up as a seller — open, no review.
2. Create a digital product; post a crafted `url` straight to the action rather
   than uploading a file.
3. Price it at zero, or apply a 100%-off coupon. Stripe then reports
   `no_payment_required`, which now settles immediately and releases the
   download — so no money need change hands.
4. Open the download link. The server fetches the attacker's chosen URL and
   hands back the body.

Reachable targets: cloud metadata endpoints, anything else routable from the
function, and Sailo itself as an open proxy with a legitimate TLS certificate.

### Why nothing caught it

The `remotePatterns` allowlist in `next.config.ts` and the CSP `img-src` both
name the blob host — but they govern **images rendered in a browser**. Neither
constrains `fetch()` inside a route handler. The check looked present and was
not.

### The fix

`isStoredFileUrl` (`lib/file-urls.ts`) requires `https` and a hostname ending
in `.public.blob.vercel-storage.com`, which is what `@vercel/blob`'s `put()`
returns. Applied at both ends:

- at the **write**, so nothing off-store is stored;
- at the **fetch**, because rows written before the gate existed still carry
  what was accepted then, and a second write path added later would not know
  to ask.

27 unit tests cover the payloads that must keep failing — loopback, private
ranges, metadata IPs, `file:`/`data:`, a lookalike host without the separating
dot, and a host smuggled through credentials
(`https://…blob.vercel-storage.com@evil.tld/`, whose real hostname is
`evil.tld`).

---

## 4. Surfaces reviewed and found sound

Recorded so the next pass does not re-derive them.

- **Download entitlement.** The token is 128 bits of `getRandomValues`. `fileId`
  is UUID-validated and scoped with `inArray(productFiles.productId,
  orderedProductIds(order))`, so one order's token cannot reach another's file.
  Release, expiry and the download cap are claimed in a single `UPDATE … WHERE`,
  so two tabs cannot spend the last download twice, and a failed upstream fetch
  gives the count back.
- **Webhook ownership.** Every handler resolves its order through
  `ownedBySender`, which compares against the account recorded on the order
  itself. `charge.refunded` was the exception and is no longer.
- **Payment reference.** Restricted to `manual` rails and to unsettled statuses,
  both re-asserted in the `UPDATE`'s own `WHERE`, and it reports failure when
  that matches nothing.
- **Staff access.** Exact, case-insensitive email match against an allowlist
  read per call. Gmail dot and plus aliasing deliberately not normalised, so
  registering an alias of a staff address does not grant entry.
- **Order totals.** Every amount is recomputed server-side from the shop's own
  rows; nothing the client sends about money survives `resolveLines`.

---

## 5. Open — not fixed here

1. **No rate limit on `/api/download/[token]/[fileId]`.** Brute-forcing a
   128-bit token is infeasible, so this is load rather than disclosure, but it
   is the one public route with no ceiling.
2. **`referral` and `track` are unauthenticated writes.** Both are analytics and
   rate-limited upstream, but neither has been traced end to end yet.
3. **E2E does not cover the money path.** Not a vulnerability, a verification
   gap, and it undercuts every claim made from a green e2e run — see the note
   in `PRODUCTION-PLAN.md`.
