# 06 · Customers

**0.5s shape:** a roster you can slice. Shopify's whole page is one idea:
*segments are the product*, the list is just the default segment.

## Digested captures
- Customers list: header Export/Import/Add customer; **✨ "Describe your
  segment" AI bar** collapsed above the table; search + column picker.
- **Segments** index: table Name / % of customers / Last activity / Created by
  (Shopify logo chip); Create segment.
- **Segment detail:** header w/ Duplicate · Use segment ▾ · More actions ▾;
  stat strip (0 customers · 0% of base); **query editor** — syntax-highlighted
  `FROM customers SHOW … WHERE companies IS NOT NULL` with collapse ▾; ✨
  "Refine your segment" bar; results table below w/ its own empty state.
- Companies (B2B) child — N/A for Sailo v1.

## Sailo status & direction
Clients list: table + tags filter + add/export ✓. Members ✓. Tags ARE our
segments-lite.
**Direction (spec, build later than P6):** promote tags to named segments:
- `/admin/clients` keeps the roster; tag filter chips become a "Segments" row
  (each saved tag-query = a chip with count).
- Segment = saved filter {tags, hasOrders, spentMin, joinedSince} — a form, NOT
  a query language (a 35-locale audience writes no SQL). The ✨ describe-slot is
  reserved beside the filter row.
- Members stays its own room (recurring money ≠ audience slicing).

## Near-term deltas (P1/P2 riders)
- [ ] Column picker + bulk select on clients table
- [ ] Header: fold Export into ⋯ menu, keep Add contact primary
- [ ] Client detail: prev/next + order-history chips use order numbers (04)
