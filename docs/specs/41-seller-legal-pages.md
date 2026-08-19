# 41 — Seller legal pages (and storefront sections)

**Priority:** P2 · **Effort:** S · **Depends on:** nothing · **Blocks:** nothing

## What

A seller answers a short questionnaire and gets hosted Terms, a Privacy Policy,
an About page and an FAQ section — linked from their checkout, which already
demands a terms URL and today has nothing to point at. Reference: Easytools
Sites → Legal pages / Easylegal, §`generate-privacy-policy-terms`.

## Where Sailo stands

Sailo's *own* legal pages are written and substantial — `(legal)/terms` at 653
lines, `privacy` at 584, `refunds` at 344, and `PRODUCTION-PLAN.md` §4 rules
them "leave whole: prose is data." Correct, and unrelated to this spec.

What a **seller** gets is `shops.termsUrl` plus `requireTerms` — a boolean that
forces the buyer to accept terms, with server-side enforcement and a timestamped
consent record (spec 05). So the enforcement is built, and the seller must go
and find a document somewhere else to satisfy it. Most will paste nothing, and
`requireTerms` stays off.

## Scope, kept small on purpose

This is **not** a legal-document product and must not read as advice. It is a
template rendered from facts the seller has already given us — company name,
registered address, country, contact email, refund window, what they sell —
almost all of which `shops` already holds for the invoice identity.

The output is a hosted page, editable, with an obvious "this is a starting point,
have it reviewed" notice. Easytools sells a generator; we ship a template, and
the difference is honesty about what it is.

## Data model (migration, production first)

`drizzle/NNNN_shop_pages.sql`.

```
shop_pages  id, shop_id → shops(cascade),
            kind text not null,     -- terms | privacy | refunds | about | faq
            slug text not null,
            title text,
            body_md text,           -- the rendered template, then seller-edited
            template_version text,  -- which template produced it
            source text default 'generated',  -- generated | custom
            is_published boolean default false,
            created_at, updated_at
            unique (shop_id, kind)
            unique (shop_id, slug)
```

One row per kind: a shop has one privacy policy. `body_md` is stored **rendered**
rather than as answers, because a seller edits it and a regeneration must not
silently discard their edits — regenerating warns, and offers a diff.

`faq` uses the same table with `body_md` as a list of Q/A pairs in markdown; a
separate FAQ table would be one object for two shapes.

## Behaviour

**Generating.** A four-field form for what `shops` does not already have
(refund window in days, what personal data they collect beyond the order,
whether they use analytics — which we can *pre-answer* from `metaPixelId` /
`gtmContainerId` / `tiktokPixelId` being set, and should). Everything else comes
from the invoice identity: `invoiceLegalName`, `invoiceCity`,
`invoiceRegion`, `invoicePostalCode`, `invoiceCountry`,
`invoiceRegistrationNumber`, `taxId`, `contactEmail`.

**Hosting.** `/[handle]/p/[slug]` collides with the existing product route
(`[handle]/p/[slug]`). Use **`/[handle]/legal/[slug]`** and add all reserved
segments to the handle-squatting test that reads `src/app` off disk — that test
found `/refunds` after six routes had been added by hand, and it will find this
one too if the entry is forgotten.

**Wiring to checkout.** `shops.termsUrl` and a new `privacyUrl` accept either an
external URL or an internal page reference. When a generated Terms page is
published, offer one click to point `termsUrl` at it and turn `requireTerms` on.
That single click is the reason this spec exists.

**Storefront sections.** Two small additions the page-builder refusal
(`GAP-2026-08-easytools.md` §4.1) explicitly left room for: an FAQ accordion and
an About block, rendered on the storefront from `shop_pages`. Not a section
editor — two known blocks, on or off.

## Details that must not be missed

- **The disclaimer is not optional and not dismissible.** One line at the top of
  the generator and a line in the page footer. Adopt Easytools' register from
  their tax wizard: *"we make this easy to understand but not automatic, as we
  believe you being responsible for your business is a good thing."*
- **Markdown goes through the existing pipeline** (`broadcasts/markdown.ts`) with
  its sanitiser. This is seller-authored HTML-adjacent content on a public page —
  the same threat as a broadcast body, and the pipeline already handles it.
- **35 locales is the interesting problem here.** A *template* in 35 languages is
  not a translation job, it is 35 legal documents, and machine-translating a
  refund clause is exactly the case §6's Decision A says never to machine
  translate. **v1 generates in English only**, with the shop's own locale
  offered as a plain-text editable copy and no claim of legal equivalence. The
  admin *chrome* around it is translated normally; the document is not.
- **`template_version`** so a template fix can list which shops are on an old
  one without touching their edits.
- **Public and cached** under `shopTag`; publishing revalidates.
- **No PDF.** A page is enough; a PDF is a second renderer and a second layout
  bug (`apps/web/src/lib/invoice-pdf.ts` is 367 positional lines and is deliberately left
  whole — do not grow a second one).
- **Plan gate:** free. A seller with no terms is a compliance risk to the
  platform, and gating this earns nothing.

## Testing

Unit: template rendering from a complete and a sparse `shops` row (a missing
company name must produce a page that says what is missing, not "undefined");
the analytics pre-answer derived from the three pixel columns; slug validation.

Scenario: generate → edit → publish → public page renders and is cached under
`shopTag`; regenerate warns and does not silently discard edits; pointing
`termsUrl` at the page satisfies `requireTerms` and the consent timestamp is
still written (spec 05's scenario must stay green); a reserved-segment handle is
refused by the disk-reading route test.

## Done when

A seller answers four fields, gets four hosted pages and an FAQ, turns
`requireTerms` on with one click, and nothing anywhere presents the output as
legal advice.
