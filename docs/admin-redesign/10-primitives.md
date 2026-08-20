# 10 · Primitive Inventory (build in P1, everything else consumes)

| Primitive | Spec | Consumers |
|---|---|---|
| **TopbarSaveBar** | Context + hook; dirty forms swap the palette slot for ⚠ label + Discard/Save; ⌘S/Esc; crossfade 150ms; role=status | settings, product edit, coupon, broadcast, legal |
| **ListRow** | icon · title · sub · trailing (chevron / Toggle / status chip / value+chevron); rows stacked in a Card with divide-y; 44pt; whole row clickable when chevron | payments config, notifications, settings general, customer accounts-style pages |
| **TypePickerDialog** | Dialog listing 2–5 kinds: icon + title + one line + ›; keyboard 1..n; feeds create routes | coupon create, product create entry (audit later), manual-method add |
| **SummaryRail** | sticky right card(s) on create forms; restates config in sentences from the SAME predicates the domain enforces (never a second truth) | coupon, broadcast, (product edit uses meta rail instead) |
| **RecordNav** | prev/next arrows in PageHeader; hrefs computed from the list's own ordering; ⌘↑/⌘↓ | product edit, order detail, client detail |
| **BulkTable additions** | checkbox col + selection header (count + actions) + ColumnPicker popover (persisted per page in localStorage) | orders, products, clients |
| **LearnMore** | centered quiet docs link, one per page | every list + settings section |
| **StatusChip** | the read-mostly sibling of Badge: `Active/Setup incomplete/Off` with tone map; NEVER interactive | payments providers, languages, users |
| **DefinitionTitle** | dotted-underline card title + accessible tooltip definition | analytics cards, live view |
| **Elbow child marker** | active-child `↳` treatment in rails | main rail, settings rail |
| **AI slot policy** | ✨-prefixed purple affordances are RESERVED slots: render only behind `aiEnabled` flag with a real endpoint; never ship a dead input | home ask bar, category suggestion, segment describe, language suggestion |

## Global rules (restated from skills, binding)
- Modality ladder: inline → popover → dialog → room. TypePicker is a dialog
  because it interrupts exactly one decision.
- Motion: chrome ≤200ms fades; user-initiated layout moves = springs
  (.35/.15); keyboard-frequency = none; reduced-motion collapses all.
- Every interactive: hover/focus-visible/active/disabled/loading. Every list:
  empty (drawn), filtered-empty (row), error (Alert).
- Tables: money right + tabular-nums; badges never wrap; row identity column
  first and linked.
- No costume features: no globe without geo data, no dead AI inputs, no
  matrix rows for features we don't have.
