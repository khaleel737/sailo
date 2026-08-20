# Sailo Admin — The Full Redesign Spec

**Status:** SPEC. Nothing in this tree is implementation; every file here is the
contract the implementation follows. Source of truth: 172 Shopify admin captures
digested pixel-by-pixel (settings taxonomy ×23, main-nav pages ×19, plus the
earlier orders/general/home/plans saved pages), read through the loaded skill
lenses — impeccable (Operate mode), Emil Kowalski (motion), web-taste (0.5s
shape per page), ui-ux-pro-max (a11y/touch/contrast floor), anthropic-frontend
(token discipline).

**The law:** Shopify's structure, Sailo's skin. Frame, density, hierarchy and
behaviors are measured from the captures. Color (ink + leaf green), type
(Geist), radii (xl/2xl) stay Sailo's. Never clone Polaris pixels; clone its
*decisions*.

**Translations are the LAST phase.** No i18n work rides a design phase. New
strings ship English-first and batch-translate once, at the end.

## File map

| File | Covers |
|---|---|
| `01-shell.md` | Top bar, **dirty-state save bar**, sidebar, ⌘K, footer |
| `02-settings.md` | The settings dialog: rail search, chips, breadcrumbs, all sections |
| `03-dashboard.md` | Home: ask bar slot, task cards, KPI strip |
| `04-orders.md` | Orders list, order detail, abandoned checkouts |
| `05-products.md` | List, product detail two-column, media/files |
| `06-customers.md` | Clients, segments direction, members |
| `07-growth.md` | Discounts create (2-col + summary rail), broadcasts, affiliates, attribution |
| `08-analytics.md` | Analytics page split from Home; KPI strip; live view scope |
| `09-payments.md` | Stripe-first hero, manual methods flow, config list |
| `10-primitives.md` | Every shared primitive this redesign adds or upgrades |

## The systems the captures demand (app-wide)

1. **Dirty-state save bar** — the single biggest missing pattern. When any form
   is dirty, the top bar's center swaps search for `⚠ Unsaved <thing> — [Discard] [Save]`
   (capture: discounts-new). One provider component; every form opts in.
2. **Learn-more footer** — every Shopify page ends with a quiet centered
   `Learn more about <topic>` link. Ours: one `LearnMore` primitive → docs site.
3. **Chevron ListRow** — the settings vocabulary: icon + title + subtitle +
   trailing chevron/toggle/status chip, rows in a card (captures: notifications,
   payments config, customer accounts, general store-contact).
4. **Two-column create/detail forms** — main cards left, sticky summary/meta
   rail right (captures: discount create, product detail).
5. **Record prev/next** — detail pages get ↑/↓ arrows in the header (product detail capture).
6. **Bulk selection + column picker on tables** — checkbox column, header
   actions appear on selection; column-visibility popover (files, users, billing tables).
7. **Type-picker dialog before create** — "Select discount type" modal pattern.
8. **Status chips over selects where status is read-mostly**; selects only where
   the seller actually flips state.
9. **AI affordance slots** — Shopify threads AI everywhere (ask bar, "Describe
   your segment", suggested category, language suggestion banner). We spec the
   *slots* now, fill them when we have a model endpoint; never fake it.
10. **Breadcrumb sub-pages inside settings** (Payments → Manual payment methods).

## Phase plan — design first, translations last

| Phase | Scope | Files |
|---|---|---|
| **P1 — Chrome primitives** ✅ built · verified | Save bar, LearnMore footer, ListRow, type-picker dialog shell, bulk-select/column-picker table upgrades | 10, 01 |
| **P2 — Settings dialog v2** ✅ built · verified | Rail search, shop chip top / account chip bottom, breadcrumbed sub-pages, sub-nav (Team → Roles/Security), General restructured (order ID format, order processing), Notifications restructured into chevron rows | 02 |
| **P3 — Payments** ✅ built · verified (config-rows card deferred: no real rows yet — no furniture) | Stripe-first hero card, providers list, Payment configuration list, Manual methods sub-page with add-method menu | 09 |
| **P4 — Creation flows** ✅ built · verified (delivered at field scale: generate-code + live glance strip + save bar; full-page + type dialog deferred until coupon types grow) | Discount/coupon create → 2-col + summary rail + type dialog; broadcasts composer same grammar | 07 |
| **P5 — Product detail v2** ✅ built · verified (suggested-category slot + SEO preview deferred: no endpoint / stretch — no furniture) | Two-column with right meta rail, prev/next, suggested-category slot, variant matrix polish | 05 |
| **P6 — Analytics split** ✅ built · verified (live-view globe deliberately not built — no geo-session data; page ticks via the global LiveRefresh instead) | `/admin/analytics` page (KPI strip + report grid) carved out of Home; Home becomes task-first | 08, 03 |
| **P7 — Orders v2** ✅ built · verified | Order detail told in full (fulfilment gate fix + promoted tracking form, timeline, checkout answers, statement descriptor, membership chip) + bulk select/actions on the list — scoped 2026-08-20 after the seller-can't-ship audit | 04 |
| **P8 — Sweep & i18n** ✅ done (2,618 strings ×34 locales via --from batch; 306 protected strings held for a human; RTL verified in ar; range-pill preset labels noted as pre-existing EN debt) | States audit, RTL pass, THEN one translation batch for every string added in P1–P7 | all |

Each phase: spec section → build → browser-verify at 1440/390 → detector — then
the next phase. No phase skips verification. No phase touches translations.
