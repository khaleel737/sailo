# 45 — The order evidence pack (PDF)

**Priority:** P1 · **Effort:** L · **Depends on:** 44 (there is nothing to
print until capture lands) · **Blocks:** nothing

## What

One PDF per order, rendered on demand from an immutable snapshot, that states
everything Sailo knows about that sale in the shape a card network reads — and
which fills Stripe's evidence file slots automatically instead of asking the
seller to upload documents they do not have.

A seller opening a dispute should find the evidence **already assembled**, not a
form asking them for a receipt.

## The gap, precisely

`assembleEvidence` in `packages/core/src/disputes/assemble.ts` returns an
`AssembledField[]` where each field is `held | missing | needs_seller |
not_applicable`. The **text** fields are largely `held` — Sailo genuinely
assembles `access_activity_log`, `product_description`, `customer_purchase_ip`,
`billing_address`, `service_date` and the rest, and does it well.

The nine **file** fields in `EVIDENCE_FILE_FIELDS` are all `needs_seller`,
every time, with a `FILE_ASKS` string:

| Slot | What it asks the seller for | Does Sailo already hold it? |
|---|---|---|
| `receipt` | "Upload the receipt or invoice the buyer was sent." | **Yes** — `invoices`, and `renderInvoicePdf` already prints it |
| `refund_policy` | "Upload your refund policy as the buyer saw it." | **Yes, after 44** — `policy_snapshots` |
| `cancellation_policy` | "Upload your cancellation terms as the buyer saw them." | **Yes, after 44** |
| `customer_communication` | "Upload the messages…" | **Yes, after 44** — `order_messages` |
| `service_documentation` | — | **Yes** — bookings, `tickets`, `member_checkins`, `download_events` |
| `shipping_documentation` | "Upload proof of delivery…" | **Partly, after 44** — tracking + `delivered_at` |
| `duplicate_charge_documentation` | — | **Yes** — `duplicateOf` in `holdings.ts` already locates it |
| `customer_signature` | "Upload the buyer's signature, if you hold one." | No — genuinely a seller upload |
| `uncategorized_file` | "Upload anything else…" | No — the seller's own catch-all |

**Seven of nine are things Sailo can print.** The seller is being asked to
manually produce documents from data sitting in our own database, an hour before
a deadline, and most will not manage it. That is the whole feature.

## Rendered on demand from a snapshot — not stored per order

The tempting shape is "generate a PDF when the order is paid and store it in
Blob". Do not. Two reasons, and the second is the codebase's own:

1. Storing a multi-page PDF for every order ever placed is a bandwidth and
   storage cost paid on 100% of orders to serve the ~0.1% that get disputed.
2. `disputes.evidenceSnapshot` already documents why a snapshot beats a
   reference — *"the order it was assembled from keeps changing: the seller edits
   a product, marks something shipped, issues a refund."* The right unit to make
   immutable is **the facts**, not the rendering.

So: spec 44 makes the facts durable (descriptor, policy text, messages,
delivery, download log). This spec renders them, deterministically, whenever
anybody asks — the seller from the order page, staff from the dispute desk, and
the submitter at the moment of submission. "Always ready" means *always
renderable from data that cannot drift*, which is stronger than a file written
once and never checked again.

`evidence_pack_version` on the render, recorded into `disputes.evidenceSnapshot`
alongside the payload, so a case reviewed later can be re-rendered exactly.

## Documents, not one document

Stripe's evidence object has **one file slot per field** and the networks read
per-field: an adjudicator looking for proof of delivery should not have to find
page 7 of a general pack. So the generator produces a small set of purpose-built
PDFs plus one human-readable pack:

| Document | Fills | Contents |
|---|---|---|
| **Order evidence pack** | `uncategorized_file` | Everything below in one document, with a contents page. This is the one a seller downloads, keeps, or emails |
| **Receipt** | `receipt` | `renderInvoicePdf` output where an invoice exists; otherwise an order receipt in the same layout, plus the statement descriptor the buyer saw |
| **Policy** | `refund_policy`, `cancellation_policy` | The `policy_snapshots` text, with its capture date and content hash printed |
| **Communications** | `customer_communication` | Every `order_messages` row: date, direction, address, subject, body, delivery status |
| **Fulfilment** | `shipping_documentation` (physical) or `service_documentation` (digital/service/event/membership) | Per kind — see below |

### The fulfilment document, per product kind

This is where the pack earns its keep, because each kind is won differently:

- **physical** — tracking carrier, number, URL, `shippedAt`, `delivered_at` with
  its `delivered_source` **stated plainly** ("marked delivered by the seller" is
  not "signed for"), `delivery_signed_by`, and the shipping address as charged.
- **digital** — the `download_events` log: timestamp, IP, file name, one line
  each, capped at 200 as `holdings.ts` already caps it, **with the purchase IP
  printed beside it** so the match is visible rather than inferred. The
  chargebacks doc's own point: three timestamped lines with the buyer's own
  address are what a physical seller gets from a carrier.
- **service / booking** — `scheduledFor`, the duration, the location or the
  join URL, and whether the appointment was marked completed.
- **event** — the `tickets` row: code, `usedAt`, `checkedInBy`. A scanned ticket
  is attendance, which is the strongest evidence a `product_not_received` claim
  can meet.
- **membership** — `member_checkins` attendance, `subscriptions` period history,
  and every renewal invoice. For `subscription_canceled` (Visa 13.2) the
  argument is *continued use after the claimed cancellation date*, and check-ins
  are exactly that.

## Implementation

**Reuse the renderer.** `apps/web/src/lib/invoice-pdf.ts` (367 lines,
positional layout, deliberately left whole per `PRODUCTION-PLAN.md` §4) already
produces a correct PDF with the shop's identity on it. Extract its primitives —
page setup, the text/label/rule helpers, the footer — into a small shared module
and build the pack sections on top. **Do not start a second PDF library**, and do
not restructure `invoice-pdf.ts`'s layout logic: each section there depends on
the `y` the last one left, which is exactly why it was left whole.

Where it lives: `packages/core/src/disputes/pack.ts` for the pure *content*
assembly (what sections, in what order, from what holdings — testable from object
literals, no renderer), and the renderer beside `invoice-pdf.ts` where the
positional layout belongs.

**Auto-fill at dispute open.** When `charge.dispute.created` records a dispute,
generate the applicable documents and register them as `dispute_evidence_files`
rows exactly as a seller upload would — same table, same `field` uniqueness, same
budget check, `uploadedBy = 'sailo:auto'`. The readiness panel then shows those
slots as **held** rather than `needs_seller`, and the seller's job shrinks to the
two that are genuinely theirs.

**The 4.5 MB budget is the real constraint.** `EVIDENCE_FILE_BUDGET_BYTES` is
4,500,000 across *every* file on the dispute, enforced from the set in
`packages/core/src/disputes/files.ts`. Generated documents must be small — text,
no images beyond the shop logo, no embedded fonts beyond one — and they must be
added **lowest-value-first-out**: if the seller then uploads a real carrier POD,
Sailo's generated fulfilment document should yield to it rather than blocking it.
Add a `priority` notion to the auto-registered rows so `files.ts` can evict a
generated document in favour of a seller's, and say so in the UI.

> **Verify before building:** whether attaching one Stripe file id to several
> evidence fields counts once or several times against the combined cap. Treat
> it as counting several times until measured. `docs/chargebacks.md` established
> the method — check it against the live API in test mode and record what the API
> said, not what the docs say.
>
> **Measured, 19 August 2026 — it counts several times.** A 3,607,988 B file on
> `receipt` alone was accepted; the same id added to `uncategorized_file` was
> refused at 7,215,976 B. Two further findings came with it: the combined ceiling
> is ~4.8 MB rather than the 5 MB Stripe's own error names, and the 50-page limit
> is **enforced** by the Files API rather than the guidance the docs describe —
> which a generated pack could exceed. Transcript and the fixes in
> `docs/chargebacks.md` §10.

## Details that must not be missed

- **Never state a fact Sailo does not hold.** A pack that says "delivered" when
  a seller ticked a box, or prints a policy fetched today for an order from
  March, is worse than an empty slot — it is a false claim to a bank, made in
  Sailo's name on the seller's behalf. Every line carries its provenance and its
  date. `delivered_source` exists for exactly this.
- **The pack must be honest about what is missing.** A "not on record" line, not
  a blank. An adjudicator reading a gap draws the worse conclusion; a stated gap
  with the rest of the document intact does not.
- **No buyer card data, ever.** Last four and brand only, from Stripe's charge,
  and nothing else. No `buyerDeviceFingerprint` in the human-readable pack — it
  goes to Stripe as a CE3 match point and means nothing to a reader.
- **Access control.** The pack contains a buyer's name, email, address and IP.
  Three readers, three checks: the shop (through `requireShop` and, after spec
  37, an `orders.view` permission), staff (a named `StaffCapability` — the
  auto-memory rule), and nobody else. **No public token route.** Unlike an
  invoice, this is not a document the buyer gets.
- **Rate-limit the render** per order and per shop. It is a CPU-bound public-ish
  endpoint and generating 200 download-log lines is not free.
- **Deterministic output.** Same inputs → byte-identical PDF, which means no
  `Date.now()` in the document beyond a "rendered on" line that is passed in.
  This is what makes "re-render the case exactly" true rather than approximate.
- **Available before any dispute.** The seller can download the pack from the
  order page at any time. That is what "always ready" means, and it is also the
  best way for a seller to discover a gap while it is still fixable.
- **Platform-scope disputes get a different pack** — spec 46. This one must not
  be pointed at a `scope = 'platform'` dispute; there is no order.
- 35-locale strings for the seller-facing UI. **The pack itself renders in one
  language per dispute** — the buyer's locale where known, else the shop's —
  because a document mixing two languages is harder for an adjudicator, not
  easier. Section headings translate; snapshotted content never does.

## Testing

Unit (pure, from holdings literals — no renderer): section selection per product
kind over all five kinds; the "not on record" line for every absent fact;
provenance labelling for all three `delivered_source` values; download-log
capping at 200; determinism (same holdings → same content structure twice);
byte-budget estimation.

Scenario: a dispute on a digital order auto-registers a fulfilment document with
the download log and the purchase IP; a physical one registers tracking and
labels a seller-marked delivery as seller-marked; a seller uploading a real POD
evicts the generated document and the budget check passes; the pack renders for
every kind without throwing on an order with no invoice, no messages, no policy
snapshot and no delivery; a `scope = 'platform'` dispute is refused; a member of
another shop cannot render it; the same order renders byte-identically twice.

Also: render one and **read it**. A PDF that compiles and lays out wrongly passes
every test above. `PRODUCTION-PLAN.md`'s rule — render it and read the visible
text — applies to a document more than to a page.

## Done when

A seller opens any order and downloads a complete, honest, dated evidence pack;
a dispute arrives and seven of nine file slots are already filled without anybody
uploading anything; every generated line names where it came from; a real
carrier document displaces ours rather than being blocked by it; and nothing in
any pack asserts a fact Sailo did not record.
