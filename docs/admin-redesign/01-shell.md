# 01 · The Shell

**0.5s shape:** a black command bar over a quiet gray rail over white cards —
and when a form is dirty, the bar itself becomes the save control.

## Digested captures
- Top bar: black `#1a1a1a`, 48–56px. Logo left. **Centered search** (dark inset
  field, `⌘ K` chips inside the field's end). Right: apps icon · bell (red count
  badge) · store chip (green tile + name).
- **Dirty state (discounts-new capture):** the search is REPLACED by
  `⚠ Unsaved discount … [Discard] [Save]` — same slot, same width. Save is
  disabled until valid. The page ALSO keeps a bottom-right Save. Bar returns to
  search on save/discard.
- Sidebar (light `#ebebeb`): flat top level — Home, Orders, Products,
  Customers, Growth, Discounts, Content, Markets, Finance, Analytics — then
  `Sales channels >` group (Online Store → Pages/Preferences), `Apps >`, and
  **Settings pinned bottom-left with a gear**. Children indented, text-only,
  with an elbow connector on the active child (`↳`); children only visible when
  section active. Active row = white pill + shadow.
- Every page ends with centered `Learn more about <x>` link.

## Sailo mapping (already live, keep)
Topbar dark ink-950 · leaf tile + shop chip · centered ⌘K trigger · bell/help/
language/account · light rail with doors+rooms · Settings pinned · sheet on
mobile. **Do not re-litigate these.**

## Deltas to build
1. **SaveBar** (P1) — `TopbarSaveBar` context: any form registers
   `{ label, dirty, saving, onSave, onDiscard, valid }`. When a registered form
   is dirty, topbar center renders the save strip instead of the palette
   trigger; Esc/⌘S map to discard/save. Motion: 150ms crossfade, no layout
   shift (same slot width). Registrants (rollout order): settings forms,
   product form (edit mode), coupon form, broadcast composer, legal editor.
   Emil rule: state change, not decoration — no spring, fast fade.
2. **LearnMore footer** (P1) — `<LearnMore topic="orders" />` under every page
   body; links to docs site anchors; quiet `text-xs text-ink-400`.
3. **Rail polish** — child rows gain the elbow connector glyph on the ACTIVE
   child only (border-s stays for the group); keep icons off rail children
   (sheet keeps them).
4. **Bell count** — red badge already exists; cap at 9+ (already done).

## States & a11y floor (ui-ux-pro-max)
Save bar: `role="status"` on the unsaved label; Save disabled ⇒
`aria-disabled` + reason in tooltip; 44pt touch targets; focus-visible on all
three controls. Reduced motion: crossfade → opacity only.

## Tasks
- [ ] `topbar-save-bar.tsx` provider + hook `useSaveBar()`
- [ ] Wire settings forms + coupon form + product edit
- [ ] `learn-more.tsx` + wire on all list pages
- [ ] Elbow connector on active rail child
