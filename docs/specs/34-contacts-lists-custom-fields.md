# 34 — Contacts, Lists, Custom Fields, Unsubscribes

**Priority:** P0 · **Effort:** L · **Depends on:** nothing ·
**Blocks:** 30 (the `list.joined` trigger)

## What

One audience, addressable by list, described by fields the seller invents, with
the suppression state visible. Reference: Easytools Campaigns → Audience /
Lists / Unsubscribed / Settings → Custom fields. Their
§`contacts-lists-unsubscribes` is the single most carefully written page in
their documentation and its eight rules are the specification for this one.

## The problem in Sailo today: two half-audiences

- `clients` — buyers. Has tags (GIN-indexed, spec 23), `marketingConsentAt`,
  manual add, CSV import.
- `newsletter_subscribers` — people who signed up at `/[handle]/subscribe`
  and never bought.

A segment can reach both because `segment-sql.ts` asks orders and lines and
consent. But there is **no screen that shows one audience**, no list object, no
custom field, and no page for `email_suppressions` — which is a correct model
with no window onto it.

Spec 30 needs "added to list" as a trigger, so the list object is on the
critical path.

## Data model (migration, production first)

`drizzle/NNNN_audience.sql`.

```
contact_lists      id, shop_id → shops(cascade), name, description,
                   double_opt_in boolean default true,
                   created_at, updated_at
                   unique (shop_id, name)

contact_list_members  list_id → contact_lists(cascade),
                      email text not null,
                      client_id → clients(set null),
                      subscriber_id → newsletter_subscribers(set null),
                      status text default 'subscribed',
                        -- subscribed | pending | removed
                      source text,  -- signup | import | manual | purchase | api
                      joined_at, removed_at
                      primary key (list_id, email)

contact_fields     id, shop_id → shops(cascade), key text, label text,
                   type text,  -- text|longtext|checkbox|integer|decimal
                               -- |dropdown|date|datetime
                   options jsonb, required boolean default false,
                   scope text,  -- contact | checkout | both
                   position integer, created_at
                   unique (shop_id, key)

contact_field_values  contact_email text, shop_id, field_id → contact_fields
                      (cascade), value jsonb, updated_at
                      primary key (shop_id, contact_email, field_id)
```

### Keyed on email, deliberately

Their Rule 5 is the design and it is right: *"Contacts are unique per account,
by email, case-insensitively."* Sailo's two source tables cannot be merged
without a migration that would rewrite the order ledger, so the unifying key is
the **address**, lowercased, and `clients`/`newsletter_subscribers` remain the
sources of *fact*. `contact_field_values` and list membership hang off the
address so they survive either row being deleted — the same reasoning spec 30
gives for `automation_runs.email`.

Gmail dots-and-plus aliasing is **not** normalised, matching
`staff_members`' documented reasoning: `a.b@` reaches the same inbox as `ab@`
but is a different account, and treating them as equal lets anyone registering
an alias act as someone else.

## The eight rules, adopted

Their page exists because these are the questions every mailing tool gets wrong.
Implement each explicitly and test each explicitly.

1. **Adding to a list does not resurrect a past unsubscribe.** A global
   suppression outranks every list write. Adding a suppressed address writes a
   `contact_list_members` row and the address still receives nothing.
2. **"Remove from list" ≠ "unsubscribe".** Removal is `status = 'removed'` on
   one list. Unsubscribe is an `email_suppressions` row. Two different verbs,
   two different buttons, never one confirm dialog for both.
3. **Who receives a campaign** is: on the audience, minus every suppression,
   minus no-consent. The consent floor stays where `segment-sql.ts` puts it —
   inside the query, ANDed, never a post-filter.
4. **One person, one email per campaign**, even on three lists. Dedupe on the
   lowercased address at recipient assembly, in SQL.
5. **Adding an existing address updates rather than duplicates** — and their
   import gotcha is the detail to copy: *blank standard fields overwrite, blank
   custom fields don't.* Blank ≠ zero, restated for imports.
6. **Double opt-in per list.** `double_opt_in` default true, reusing the
   existing signup token path unchanged. A `pending` member is not a recipient.
7. **Custom fields** are per-shop, typed, and merge-taggable in campaign and
   automation bodies.
8. **Account-level opt-out** is absolute: `email_suppressions` (bounced,
   complained, unsubscribed) plus `marketing_opt_outs`, and only a fresh
   confirmed opt-in lifts an `unsubscribed` one — **never** a `bounced` or
   `complained` one. That rule already exists in this tree; this spec must not
   weaken it.

## Screens

- **Audience** — one table over both sources, with the existing 19-rule filter
  UI (`+ Add filter` / `+ Add filter group`, theirs) driving `segments.ts`.
  Columns: email, name, source, lists, consent, suppression, orders, spend.
- **Lists** — CRUD, member count, double-opt-in toggle, CSV import per list.
- **Unsubscribed** — `email_suppressions` with the reason, date and list, and
  a resubscribe action that **only** works on `unsubscribed`, guarded by the
  same warning banner theirs carries.
- **Settings → Custom fields** — CRUD over `contact_fields`, eight types.

## Checkout custom fields (their other half)

`scope` is what makes one table serve both surfaces. A field with
`scope = 'checkout' | 'both'` renders in the checkout form; the answer writes
`contact_field_values` *and* snapshots onto the order, because an order must
record what was answered at the time even if the field is later deleted or
retyped — the same reason `orders` snapshots `variant_sku`.

Per-variant overrides (theirs) are **not** in v1: a per-variant field set means
the checkout form changes as the buyer switches variant, which is a re-render
of the form mid-entry. Shop-level and per-product only.

## Details that must not be missed

- **Import cannot grant consent.** Same invariant as `POST /contacts`: an
  importer ticking "these people consented" is a claim, not consent. Import
  writes `source = 'import'` with no `marketingConsentAt` unless the CSV
  carries a **timestamp and a source**, which is what a consent record is.
- **Field keys are identifiers**: `^[a-z][a-z0-9_]{0,39}$`, immutable after
  creation, and reserved against `email|name|first_name|last_name|phone` so a
  custom field cannot shadow a standard one in a merge tag.
- **Merge tags are substituted into finished HTML, escaped** — the existing
  rule from `markdown.ts`, and it now applies to arbitrary seller-defined
  values. A dropdown option is seller input; a text answer is *buyer* input.
- **`dropdown` options are a closed set** validated server-side on submit. A
  free-text value in a dropdown field is how a validation gap becomes a CSV
  injection two exports later.
- **CSV export escapes formulas** (existing rule) across every new column,
  custom field values included.
- **Plan gate:** lists and the unified audience on Pro (they make broadcasts
  usable, which is Business today — check `Features` before assigning);
  custom fields on Pro; checkout custom fields on Pro.
- 35-locale strings across four screens and eight field-type labels.

## Testing

Unit: all eight rules as a table test, each named after the rule; the
email normaliser (case folding yes, alias folding no); field-key validator;
dropdown value validator; blank-overwrite semantics for standard vs custom.

Scenario: one contact on three lists receives one email; adding a suppressed
address to a list mails nothing; remove-from-list leaves other lists intact;
resubscribe lifts `unsubscribed` and refuses `bounced` and `complained`;
double-opt-in `pending` is not a recipient and becomes one on confirm; import
of an existing address updates standard fields and preserves blank custom ones;
a checkout custom answer is snapshotted onto the order and survives deleting
the field; `list.joined` fires spec 30's trigger exactly once per join.

## Done when

A seller sees one audience, builds lists with double opt-in, defines typed
fields that reach both the contact card and the checkout, reads the suppression
list and its reasons, and every one of the eight rules has a test named after it.
