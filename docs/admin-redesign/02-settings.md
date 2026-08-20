# 02 · The Settings Dialog v2

**0.5s shape:** a room over the admin — its own rail with a search box at the
top, the shop's identity above the list, the *person's* identity below it.

## Digested captures (all 23 settings screens)
- **Rail anatomy top→bottom:** shop chip (green avatar tile + shop name +
  domain, on a tinted header block) → **Search field** (filters the section
  list live) → sections with icons → … → **account chip pinned at rail bottom**
  (purple initials avatar + full name + email).
- **Section list (Shopify):** General · Plan · Billing · Users (**with indented
  children Roles, Security shown when active**) · Payments · Checkout ·
  Customer accounts · Shipping and delivery · Taxes and duties · Locations ·
  Apps · Sales channels · Domains · Customer events · Notifications ·
  Metafields and metaobjects · Languages · Customer privacy · Policies.
- **Content column:** header = section icon + title; page-level actions live
  top-right INSIDE the dialog (Export/Import/Add users; Add language; Buy new
  domain). **Sub-pages breadcrumb**: `💳 › Manual payment methods`.
- **General page order:** Business details → Store contact (chevron rows) →
  Store defaults (currency display row + backup region + unit system + weight
  unit + **time zone**) → **Order ID format** (Prefix/Suffix inputs + live
  preview "#1001, #1002…") → **Order processing** (require confirmation step;
  after-paid auto-fulfill radios; auto-archive checkbox) → Store assets →
  Resources → Transfer store.
- **Notifications:** sender email card (with domain warning banner) → chevron
  rows: Customer notifications / Staff notifications / Fulfillment request →
  Webhooks row.
- **Languages:** table (Language+Default tag / Status chip / Domains) +
  Adapt/Translate buttons + ✨ suggestion banner. **Users:** table w/ bulk
  checkboxes, status chip, 2FA-off red icon, role column.
- The ✕ close sits top-right of the SCRIM, not the panel.

## Sailo settings rail v2 (target)
Shop chip (leaf tile + name + /handle)
**[ Search settings ]** ← filters list, same ⌘-affinity as palette
General: Shop details · Appearance · Plan & billing
People: **Team** (children when active: *Roles*, *Security*) · Who takes bookings
Commerce: Payments ↗ · Tax & jurisdictions · Checkout* (future) 
Data & reach: Analytics & pixels · Integrations · Custom fields · Languages* → (storefront language moves here from Shop details)
Trust: Legal pages · Data requests ↗ · Security → (moves under Team? NO — account security stays its own)
System: Import & export · Notifications* (new: carve notification prefs out of Shop details)
— account chip (user name + email, links to /admin/settings/security)

*Starred = new sections carved from the Shop details monolith, same
narrow-action pattern proven by Appearance/Analytics (never blank absent fields).

## Deltas to build (P2)
1. **Rail search** — client filter over section labels; empty state "Nothing
   matches"; `/` focuses it when the dialog is open.
2. **Shop chip + account chip** in the rail (chips are links: shop→Shop
   details, account→Security).
3. **Sub-nav children in the rail** — Team active ⇒ indented Roles / Security
   rows (elbow on active). Mirrors main rail grammar; same reveal animation.
4. **Breadcrumbed sub-pages** — `SettingsBreadcrumb` primitive: parent icon ›
   child title; used by Payments→Manual methods (09), Notifications→each
   channel, Data→Import preview.
5. **Notifications section** — new: sender/notification email card + chevron
   rows splitting seller-mail switches (currently inside Shop details) from
   future buyer-mail templates. Narrow action `updateShopNotifications`.
6. **Order ID format** — Sailo has `invoicePrefix`; spec: move invoice
   numbering row from Invoicing card into a General "Order & invoice IDs" card
   with live preview line, exactly Shopify's Prefix/Suffix + preview grammar.
7. **Order processing** — map: require-terms already exists (Compliance);
   auto-archive: NEW shop column + order list default filter "open". Spec only
   in P2; build behind P2 if schema change approved.
8. **Time zone stays in Store defaults** (done) — move it OUT of Booking card
   into the Shop-details defaults card to match General's grammar.

## Content column rules
Header: icon + title (already: title only — ADD the section icon). Actions
top-right inside panel. Body max-w-4xl. Sub-page = breadcrumb replaces title.
Every section ends with `LearnMore`.

## Tasks
- [ ] Rail search + chips + sub-nav children
- [ ] `settings-breadcrumb.tsx`
- [ ] Section icon in content header
- [ ] Notifications section (carve-out, narrow action)
- [ ] IDs card w/ live preview; timezone row relocation
- [ ] Languages section: storefront-language select relocation + table of admin locales (read-only list, Default tag)
