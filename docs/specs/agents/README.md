# The six waves

Full feature set, 24 items. Paste a file's whole contents as an agent's task —
each is self-contained.

| File | Owns | Migrations |
|---|---|---|
| `wave-a-reach.md` | regional pricing (new) · imports · ~~custom domain~~ | 0036–0038 (0038 is a tombstone) |
| `wave-b-catalogue.md` | **preorders** · physical depth · pricing models · bumps + cross-sells | 0039–0042 |
| `wave-c-product-kinds.md` | **digital · membership · event · service depth** | 0043–0046 |
| `wave-d-audience.md` | contacts · **automations** · checkout recovery · integrations · **analytics** | 0047–0051 |
| `wave-e-business.md` | **teams (Better Auth)** · tax · lead capture · testimonials | 0052–0055 |
| `wave-f-paperwork.md` | legal pages · data requests + file sweep · evidence pack · platform disputes · gated content | 0056–0059 |

**Custom domains were removed from wave A on 2026-08-19 and are refused, not
deferred.** *"We will never add it, it will always be sailo.store/store-name."*
No agent, in any wave, should build a `shop_domains` table, a hostname column, a
host-based route, a per-domain canonical or CSP, or DNS verification. See
`GAP-2026-08-easytools.md` §4.11.

## Launch order

**A, B, D, E, F now. C after B's sell windows land** (event tiers reuse them —
C's own prompt says so and tells the agent to do its other three first).

Two sequencing rules that are not optional:

- **E1 (teams) lands LAST and alone.** It gives `requireShop()` a required
  permission argument and audits every call site — it is called from nearly
  every server action, so landing it mid-flight turns every other agent's branch
  into a conflict in files they never opened. Wave E's prompt says: E2, E3, E4
  first.
- **D is internally sequential.** D2 needs D1's audience, D4 shares D2's runner,
  D5 counts what D2 and D3 produce. An always-zero analytics tile reads as a
  broken product.

## Three decisions already made, carried in the prompts

- **Preorders replace waitlists.** A waitlist is a digital-launch instrument —
  availability is a date the creator picks. Sailo's sellers ship things, and
  their version of that moment is the last blue medium selling on a Tuesday.
  `33-preorders-and-back-in-stock.md`; the waitlist spec is in `deferred/`.
- **Spec 37 is rebuilt on Better Auth's organization plugin.** It ships
  `organization`, `member`, `invitation`, `team`, `teamMember`,
  `createAccessControl` and `hasPermission` — so the invitation flow, the
  expiry, the revocation and the permission evaluator are not written by hand.
  What is left is the permission vocabulary, `shops.organizationId`, and the
  `requireShop()` audit.
- **Regional pricing and the 90-day file sweep join the release.** Both are from
  `README.md`'s own *"Not built yet"* and neither had a spec — a parity analysis
  cannot surface them, because the competitor does not have the problem. The
  file sweep is in Wave F because **spec 52 promises a statutory erasure the
  store currently cannot perform.**

`../RESHAPE-2026-08.md` holds the analysis of which specs are subsystems rather
than features, and what each one's smaller version looks like. The full set is
being built; that document is the fallback if the calendar bites.

## Worktrees

    git worktree add ../sailo-wave-a -b wave-a

`packages/db/src/schema/catalog.ts` (`products`) is touched by four waves and the
34 i18n dictionaries by all six. Six agents in one checkout will spend more time
on conflicts in those two files than on building. If you share a tree anyway,
the rule from `../README.md` is absolute: **stage explicit paths, never
`git add -A`** — a bare commit takes another agent's staged files with it.

## What every agent is told

- Wave 0 is done: the chargeback suite runs again, spec 44 has landed, Decisions
  A and B are answered and built.
- Migration numbers are pre-assigned. No agent picks its own.
- The verification gate runs **before a commit**, not after every edit — while
  working, the package's own `tsc` and the one test file.
- New columns on `products` are nullable or defaulted, so an existing catalogue
  reads and sells identically the moment a migration lands.
