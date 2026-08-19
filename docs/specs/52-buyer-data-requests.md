# 52 — Buyer data requests (subject access, erasure, portability)

**Priority:** P2 · **Effort:** M · **Depends on:** nothing · **Blocks:** nothing

## What

A buyer asks a seller for a copy of their data, or asks for it to be deleted, and
Sailo answers it. Not a feature — an obligation, and the only one in this plan
with a statutory clock on it.

## Where it stands

Seller-side deletion is built and thorough: spec 03, `packages/account/src/deletion`,
password plus typed handle, an obligations refusal, the ledger retained, and
`shop_closures` written before the tombstone in an order the auto-memory notes as
load-bearing.

**Buyer-side is absent.** `dataRequest`, `gdprExport`, `subjectAccess` all match
**0 files**. Yet Sailo holds, per buyer: name, email, phone, address,
`buyerIp`, `buyerUserAgent`, `buyerDeviceFingerprint`, `termsAcceptedAt`, order
history, `download_events` with IPs, `visits` and `clicks`, marketing consent
state, suppressions, and — after spec 44 — every message sent to them and their
delivery confirmations.

The seller is the data controller for all of it; Sailo is the processor. So the
request arrives at the *seller*, and the seller currently has no way to answer it
except asking support to run SQL.

## Data model (migration, production first)

```
data_requests  id, shop_id → shops(cascade),
               client_id → clients(set null),
               email text not null,
               kind text not null,        -- access | erasure | portability
               status text default 'pending',
                 -- pending | verifying | in_progress | fulfilled
                 -- | refused | withdrawn
               verify_token_hash text, verified_at timestamp,
               requested_at default now(), due_by timestamp,
               fulfilled_at, refused_reason text,
               export_blob_key text, export_expires_at,
               actor text,                -- seller email or 'sailo:auto'
               created_at
               idx (shop_id, status, due_by)
               unique (shop_id, email, kind) WHERE status IN ('pending','verifying','in_progress')
```

`due_by` is `requested_at + 30 days`, which is the GDPR one-month response
window. It is a column and not a computation because the clock is the whole point
and the queue sorts on it.

## Behaviour

**Origin.** A link in the storefront footer and in every transactional email
footer: *"request your data"*. Public, rate-limited, and — the rule this repo
applies to every public form — **one response sentence whatever it finds**. A
form answering differently for a known and an unknown address is a customer-list
oracle, which is the same finding as `applyAsAffiliate` and the subscribe page.

**Verification comes first, always.** Nothing is assembled or deleted until a
signed token mailed to the address is clicked. An unverified erasure request is a
deletion primitive for anyone who knows a buyer's email; an unverified access
request is worse — it hands one person another's address and order history.
Token signed under **its own domain string**, expiring in 7 days, the rule already
applied to unsubscribe, signup, lifecycle and marketing tokens.

**Access / portability** assembles a machine-readable export (JSON, plus CSV for
the tables a person can read) of everything above, for **that shop only**, and
delivers it as a signed, expiring link. Never an email attachment: personal data
in an inbox forever is the thing being asked about.

**Erasure** is where the real work is, and it is mostly refusal reasoning:

| Data | Erasure |
|---|---|
| `clients` name, phone, address, tags | Erase |
| Marketing consent, list membership | Erase |
| `visits`, `clicks` | Erase or de-identify |
| `order_messages` bodies (spec 44) | **Retain** — tax and dispute evidence |
| `orders`, `order_items`, `invoices` | **Retain.** Statutory retention (typically 6–10 years) and an unbroken invoice sequence |
| `buyerIp`, `buyerUserAgent`, `buyerDeviceFingerprint` | **Retain** while a dispute window is open; erase after |
| `download_events` | **Retain** while the dispute window is open |
| `email_suppressions` | **Never erase.** A suppression is how their objection is honoured; deleting it re-subscribes them |
| `tickets`, `subscriptions`, `member_checkins` | Retain while access is live; pseudonymise after |

- **Pseudonymise, do not delete, anything a money row points at.** Replace
  identifiers with a stable surrogate and keep the row. The alternative breaks the
  ledger, and spec 03 already decided this for sellers: the ledger is retained.
- **The suppression exception is the one people get wrong.** Erasing an
  unsubscribe record and then honouring a later import is how a "deleted" person
  gets mailed again.
- **A refusal is an answer.** Where retention is required, the response says which
  data, why, and for how long. `refused_reason` is a real field the seller fills
  from a picklist, not free text they invent.

**Who acts.** The seller, from a queue in admin sorted by `due_by`, with a nudge
at 7 days remaining. Access/portability is **one click** — Sailo assembles it,
the seller reviews and releases. Erasure is one click plus a confirmation showing
exactly what will and will not be erased. Sailo staff can act only on a named
`StaffCapability` and every action lands in an append-only log.

**Sailo's own obligations are separate.** A buyer may also have a claim against
Sailo as processor. HQ gets the same queue, shop-scoped, and it must not be able
to answer on a seller's behalf without recording that it did.

## Details that must not be missed

- **`unique … WHERE status IN (…)`** stops a buyer opening forty requests; a
  fulfilled one may be followed by a new one, which is their right.
- **The export must be scoped to one shop.** A buyer of five Sailo shops asking
  one seller must receive that seller's data only. This is the same boundary
  §4.2 refuses to cross for the buyer network, and here it is a hard access-
  control test: name another shop's id anywhere and be refused.
- **CSV formula escaping** across every column, and the export is the highest-risk
  place for it — a buyer's own name is attacker-controlled input in a file the
  seller opens in Excel.
- **`export_blob_key` expires and the blob is deleted.** An orphaned personal-data
  export in Blob is the incident this feature exists to prevent.
- **Rate-limit the public form and the verify endpoint**, and keep the response
  constant in both.
- **Update `(legal)/privacy`.** Spec 44 adds five kinds of collection; this adds
  the rights and the route to exercise them. That page is prose and is edited by
  hand.
- Plan gate: **none.** A compliance obligation is not an upsell.
- 35-locale strings: the public form, one sentence of response, the verify email,
  the seller queue, the refusal picklist, the export ready email.

## Testing

Unit: the retain/erase/pseudonymise decision table, one case per row above —
this is the spec, so every row gets a named test; `due_by` arithmetic; token
domain separation (a data-request token cannot unsubscribe, and no other token
can trigger an erasure).

Scenario: request → same sentence for known, unknown and suppressed addresses;
nothing assembled before verification; an expired token refuses; an access export
contains this shop's data and no other shop's; erasure pseudonymises the client,
leaves orders, invoices and suppressions intact, and the invoice sequence still
reconciles; a second live request of the same kind is refused; the export blob is
unreachable after expiry; a staff action without the capability is refused and
writes no row.

## Done when

A buyer clicks a footer link, verifies by email, and the seller answers inside a
tracked 30-day clock with either a scoped export or an erasure that pseudonymises
what it may and states plainly what it may not — with the suppression list
untouched and the invoice sequence unbroken.
