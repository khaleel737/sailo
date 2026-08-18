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
| **Sailo staff** | Roster table (`staff_members`), four roles | Bounded by capability — see §5 |

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
- **Staff access.** A roster row, read on every request rather than trusted
  from the session, so revoking somebody ends their access now rather than when
  their cookie expires. The environment allowlist survives as break-glass only
  and is consulted *after* the table, so a revoked founder stays revoked. Gmail
  dot and plus aliasing deliberately not normalised, so registering an alias of
  a staff address does not grant entry.
- **Order totals.** Every amount is recomputed server-side from the shop's own
  rows; nothing the client sends about money survives `resolveLines`.

---

## 5. Staff authority, and the privilege escalation that was open until now

Added 2026-08-18, with the risk desk and the closure record.

### What was wrong

`@sailo/security/staff` has declared capabilities — `money:move`,
`account:suspend` — since the roster replaced the environment allowlist. Two of
them were ever checked. Every other write in apps/hq opened with a bare
`requireStaff()`, which asks only "is this person staff at all".

So the `support` role, whose entire description is *"read, and answer tickets"*,
could:

- suspend or unsuspend **any** shop on the platform, and pause its marketing;
- comp a paid plan, or take one away;
- clear **any** seller's second factor, and sign every one of their devices out;
- revoke any seller's API keys;
- refund a disputed charge, submit dispute evidence to Stripe, and release a
  payout hold;
- approve a partner, set their commission rate and run a payout;
- send a campaign to Sailo's entire mailing list;
- download every account, every buyer's name, email and delivery address, and
  every live session, as CSV, from `/api/export/[type]`.

None of that required a bug. The pages were staff-only and nothing underneath
them asked a narrower question — which is the failure mode of declaring a
permission model and not wiring it: it reads as a control in review and it is a
comment.

### What it is now

Ten capabilities, four roles, and **every write and the bulk-export route names
the capability it needs**. `packages/security/src/staff.test.ts` asserts the
grant table case by case, including an exhaustiveness check that fails when a
capability is declared and granted to nobody.

The split worth stating, because it is the one that is not obvious:

- `account:secure` — end sessions, revoke API keys. Makes an account *less*
  reachable, so the worst case is a seller signing in again, and the thing it
  defends against is most urgent on the shift with fewest people on it.
  **Support holds it.**
- `account:recover` — clear a second factor. Ends with somebody signing in who
  could not a minute ago, and the only check on it is whether the caller was
  really the seller. That is the judgement social engineering attacks.
  **Support does not.**

`risk` is a new role between the two: it can suspend a shop, secure an account
and recover one, and it cannot move money, comp a plan, mail the list or export
anything in bulk. It exists because the risk desk is a job, and doing it under
`admin` meant handing over refunds and every buyer's address as well.

### Residual

Hiding a button is not a control and is not claimed as one. Every check is
inside the Server Action or route handler, because a Server Action is a public
HTTP endpoint with a generated name, reachable by anyone who has ever loaded the
page's JavaScript. The `staffCan` helper exists only so somebody is not offered
a button that was going to 403, and its docstring says so.

---

## 6. Deletion as an evidence-destruction path

Added 2026-08-18.

`deleteAccountFor` anonymises the ledger and deletes the rest — correct for the
seller who is leaving, and a blindfold for the one who is not. Two gaps:

1. **Deletion was not refused mid-dispute.** `openObligations` tested only
   undelivered *delivery*: an unshipped physical order or a future booking. A
   seller of digital downloads passes that trivially — the file is delivered at
   checkout and the order goes straight to `completed` — so an account with
   forty live chargebacks could be deleted, taking with it the order, the
   product and the download log needed to answer them. An unanswered dispute is
   lost by default, at Sailo's expense once the connected balance runs out.
   Open disputes and a payout hold now both refuse, and both are finite so
   neither traps an honest seller.

2. **Nothing survived that said who the shop was.** Name, handle, owner,
   catalogue, reviews and tickets are all erased; the orders survive and can no
   longer be attributed. `shop_closures` is one row written *before* the
   tombstone. It keeps the shape of the business on every closure and the
   readable identity only where the closure happened under suspicion —
   suspended, payouts held, a live chargeback, buyers undelivered, or closed by
   us — with which of the two recorded on the row itself. GDPR Art. 17(3)(b)
   and (e), Recital 47.

   The owner's address is kept on **every** closure as an HMAC under
   `BETTER_AUTH_SECRET`, never in the clear. It answers one question — is this
   signup the person who closed that shop — and cannot be read, mailed, sold or
   exported. A leaked copy of the table without the application secret is inert;
   an unsalted SHA-256 of an email address would not have been, which is why the
   ICO and EDPB still treat one as personal data.

---

## 7. Open — not fixed here

1. **No rate limit on `/api/download/[token]/[fileId]`.** Brute-forcing a
   128-bit token is infeasible, so this is load rather than disclosure, but it
   is the one public route with no ceiling.
2. **`referral` and `track` are unauthenticated writes.** Both are analytics and
   rate-limited upstream, but neither has been traced end to end yet.
3. **E2E does not cover the money path.** Not a vulnerability, a verification
   gap, and it undercuts every claim made from a green e2e run — see the note
   in `PRODUCTION-PLAN.md`.
4. **Signup does not consult the closure fingerprint.** The digest recognises a
   returning seller and apps/hq asks the question — on the risk desk, and on
   every account's Risk tab — but the registration path itself does not, so
   somebody who left buyers undelivered can open a second shop and trade until
   a human looks. Making signup check it is a small change and a product
   decision (refuse, or flag and allow), which is why it is recorded here
   rather than taken.
5. **Bulk sweeps bust the storefront cache after the response.** The single-shop
   path awaits it, because a suspension that has not reached the cache has not
   taken effect. A hundred sequential calls to the other deployment cannot be
   awaited inside a request, so a swept shop can serve one more cached page.
   Seconds, and the safe direction — but it is a real difference between the two
   paths and it is written down rather than assumed.
