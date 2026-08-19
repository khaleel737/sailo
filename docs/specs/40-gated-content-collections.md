# 40 — Gated content collections ("courses", narrowly)

**Priority:** P3 · **Effort:** L · **Depends on:** nothing ·
**Supersedes:** `deferred/18-ecourse.md`

## What

Ordered, gated, resumable content: a product's files grouped into sections,
in a sequence, with a page that lists them and remembers where the buyer got
to. Reference: Easytools Courses / Easyplayer, §`create-and-manage-your-own-player`.

## Re-opening the deferral, and narrowing it

`deferred/18-ecourse.md` was parked as *"not needed — not Sailo's product
direction now."* Courses sit in Easytools' primary nav, so the deferral is worth
revisiting — but **not by building Easyplayer.** A video player with layout
editors, styling, transcoding and DRM is a separate business with a separate
cost base.

What Sailo is one step from is narrower and worth having, because four of the
five hard parts are already built:

| Needed | Already exists |
|---|---|
| Files, ordered | `product_files` with `position` |
| Delivery behind a gate | `/download/[token]`, hashed tokens, download limits |
| **Entitlement decided at read time, not mint time** | the rule `membershipAccess` and `door_passes` both follow |
| Recurring access, card *and* manual rails | `subscriptions`, `billing_mode` |
| Grouping, order, progress, a page | **missing — this spec** |

That last row is the whole spec. Everything else is reuse.

## Data model (migration, production first)

`drizzle/NNNN_content_collections.sql`.

```
collections        id, shop_id → shops(cascade),
                   product_id → products(cascade),
                   title, description,
                   drip_mode text default 'none',   -- none | interval
                   drip_interval_days integer,
                   created_at, updated_at
                   idx (shop_id, product_id)

collection_items   id, collection_id → collections(cascade),
                   section text,                 -- a label, not a table
                   file_id → product_files(cascade),
                   external_url text,            -- allowlisted embed only
                   title, body_md,
                   position integer default 0,
                   is_preview boolean default false,
                   available_after_days integer, -- overrides drip
                   created_at
                   idx (collection_id, position)

content_progress   order_id → orders(cascade),
                   item_id → collection_items(cascade),
                   completed_at timestamp,
                   last_seen_at timestamp,
                   primary key (order_id, item_id)
```

**`section` is a text label, not a table.** A three-level hierarchy (course →
module → lesson) needs a tree, an editor and a traversal; a section label plus
`position` renders the same page and is one column. Promote it only if sellers
ask for nested modules.

**`content_progress` is keyed on the order, not the buyer.** There is no buyer
account (`GAP-2026-08-easytools.md` §4.8) — the order *is* the entitlement, and
the download token already resolves to one. Keying on an email would let a
shared address read someone else's progress.

## Behaviour

**Authoring.** On a `digital` or `membership` product: create a collection, add
items from the product's files or an allowlisted embed URL, group by section,
reorder, mark preview items.

**The buyer's page.** Extend the existing delivery page rather than adding a
route. It already resolves a token to an order and already decides access at
read time. It gains: the collection listing, section headings, completion ticks,
a "continue" link to the first incomplete item, and a percentage.

**Access.** Unchanged, and this is the point of the spec: every item read
re-asks the same question the download route already asks —
`orders.downloadReleasedAt` for one-off purchases, `membershipAccess` for
memberships, with grace to `currentPeriodEnd` and `past_due` staying open on the
card rail and not on the manual one. **Write no new access predicate.** If a new
one appears in the diff, the spec has been implemented wrongly.

**Preview items** are the one exception: readable without an order, which is how
a seller shows lesson one for free. They are therefore **public**, and a preview
item must never be a real file — it is `body_md` or an allowlisted embed. A
"preview" that mints a download token is a paid file given away.

**Drip.** Optional: items unlock N days after the order (or, for a membership,
after the subscription started). Computed, never stored — a stored unlock date
is wrong the moment a seller changes the interval. `available_after_days` on an
item overrides the collection.

## Details that must not be missed

- **Download limits and expiry already exist** (`downloadLimit`,
  `downloadExpiryDays`) and a lesson list makes them visible in a new way: a
  buyer clicking through twelve lessons must not burn twelve allowances. Count
  an allowance per **file fetched**, not per page view, and confirm the
  legacy-file bug (`PRODUCTION-PLAN.md` §2 item 14 — a refused file burning an
  allowance per attempt) cannot recur through this path.
- **`external_url` goes through the existing allowlist and SSRF guard at the
  write**, not at render. Same rule as spec 35, same four writes that had to be
  fixed once already.
- **Progress is a buyer-driven write on a public token route.** Rate-limit it,
  key it on the token, and make it idempotent — it is the only public write this
  spec adds. It must never be able to change entitlement, only `content_progress`.
- **A membership's collection must not leak past cancellation.** The grace rule
  is `currentPeriodEnd`; the lesson list is behind exactly the same read, so
  test it explicitly with a cancelled-but-in-grace member and an expired one.
- **Deleting a file cascades its item.** The collection renders shorter and does
  not break, and the seller is told the count first.
- **Student data.** Theirs has a students view. Ours is the members list plus a
  progress column — no new screen, and no per-buyer analytics beyond completion,
  because a "who watched what, when" table is a surveillance surface a
  link-in-bio seller has not asked for.
- **Plan gate:** Pro for one collection, Business for many + drip.
- 35-locale strings: authoring UI, buyer page, drip copy, progress labels.

## Not in v1

Video hosting or transcoding, a player skin or layout editor, quizzes,
certificates, nested modules, per-lesson comments, and a separate login wall
(the token *is* the wall).

## Testing

Unit: ordering and section grouping; drip availability arithmetic across item
override, collection default, one-off vs membership anchor, and a timezone
boundary; percentage complete with zero items and with all-preview items.

Scenario: unpaid order sees only preview items; paid order sees all; a preview
item never yields a download token; clicking twelve lessons burns allowances per
file not per view; a cancelled member in grace still reads and after
`currentPeriodEnd` does not; a manual-rail `past_due` member does not; drip
hides a future item and shows it after the interval; progress writes are
idempotent and cannot alter entitlement.

## Done when

A seller groups files into an ordered, sectioned collection; a buyer reads it
from the existing delivery page with progress and a continue link; access is
decided by the predicates that already existed and no new one was written; and
preview items are the only thing an unpaid visitor can reach.
