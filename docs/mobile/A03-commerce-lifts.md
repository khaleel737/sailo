# A03 — Commerce lifts: orders, products, tickets

**Wave:** 1 · **Effort:** XL (2–3 weeks) · **Depends on:** A00 ·
**Blocks:** A07, A08, A10

> **This is the highest-risk work order in the set. It also fixes a live
> production bug in its first commit. Give it to your strongest agent.**

## Mission

Move the commerce write layer out of `apps/web` Server Actions into
`@sailo/commerce` so the phone can perform the same writes with the same side
effects, and close the correctness gap the router already documents.

## Owns — exclusive write access

- `packages/commerce/**`
- `apps/web/src/lib/actions/products.ts`
- `apps/web/src/lib/actions/tickets.ts`
- `apps/web/src/lib/actions/order-status.ts`
- `apps/web/src/lib/door-pass.ts`
- `apps/web/src/lib/queries/tickets.ts`
- `packages/api/src/routers/{products,orders,events,tickets}.ts`

**On `queries/tickets.ts`:** A10 reads its exported types — `DoorRow`,
`DoorListFilters`, `DOOR_FILTERS`, `DoorStats`, `EventSummary` — as a read-only
consumer. Keep those exports identical in name and shape when you lift, or you
break a Wave 2 agent that never touched the file.

**On plan limits:** `plans.ts` has already moved. Import `productLimit` and
`can` from `@sailo/core/plans`. There is nothing to grant and nothing to
duplicate — `products.save` enforces the same cap the web form does, from the
same source.

## The shared vocabulary goes in core

The webhook catalogue/envelope and the REST resource shapes must be importable
from `packages/api`, from `apps/web` server code, **and from web client
components**. That is `@sailo/core`'s job — it is already where the pure shared
vocabulary lives (`order-status`, `pricing`, `variants`, `currency`, `plans`).

Both files already say they belong there. `webhooks/events.ts`: *"No
`server-only` here, on purpose… the settings card renders this catalogue as
checkboxes, so the vocabulary has to be importable in the browser."*
`api/resources.ts`: *"No `server-only` — nothing here touches the database."*
And `resources.ts` already imports `@sailo/core/currency`, so the move
**removes** a dependency edge rather than adding one.

Granted: `packages/core/src/webhook-events.ts` and
`packages/core/src/api-resources.ts` (both new — no collision possible), plus
`apps/web/src/lib/api/resources.ts` to leave a shim. Leave shims at both old
paths; web imports back unchanged.

**Do not put them in `packages/commerce`.** That package's header states its
contract: *"Everything in this package touches the database and imports
`server-only`. It is not importable from a React Native bundle and is not meant
to be."* Carving an exception into a contract to fit one import turns a clear
boundary into a footgun — the next agent has to know which subpaths are safe.

**Coordinating with A02 in core:** you are in a shared working tree, so there
is no git merge to resolve — `packages/core/package.json` is last-write-wins.
Re-read the working copy immediately before you edit it, append only your two
`exports` keys, and never rewrite the map. A02 has landed `./plans` and is
still adding `./handle`.

## Never touches

Any mobile screen. Any web component. `packages/analytics` (A02).
`packages/payments` (A04).

## Do these as three separate commits, in this order

### Commit 1 — close the order side-effect gap

**Ship this first; it has standalone value. It is now two commits, 1a and 1b,
because the two halves are not the same size.**

Counted: `webhooks/emit.ts` + `webhooks/events.ts` is **~350 lines**.
`apps/web/src/lib/email/` is **3,267**, including a 1,062-line catalogue and
520 lines of HTML markup. Lifting both in one commit would drag Resend and
email templates into `@sailo/commerce`, which is the wrong home for them.

**1a — webhooks. Yours, do it now.** Lift `webhooks/{emit,events}.ts` into
`@sailo/commerce`. Additional write access granted:
`apps/web/src/lib/webhooks/{emit,events}.ts` and
`apps/web/src/lib/actions/order-admin.ts`.

*Sequencing:* `emit.ts` calls `can(shop, "integrations")` from
`@/lib/plans`. **A02 is moving `plans.ts` to `packages/core`** — wait for that
to land, then import `@sailo/core/plans`. Do **not** take write access to
`plans.ts`; it is A02's and touching it will conflict.

*Note:* `order-admin.ts` is listed in `PRIMARY_ONLY` in
`apps/web/src/replica.test.ts`. Do not introduce `getReadDb` into it.

**`emit.test.ts` comes with 1a.** Granted:
`apps/web/src/lib/webhooks/emit.test.ts`. It asserts against file text, so
moving an emit site moves what it reads — the same situation A02 handled in
`replica.test.ts`, and the same resolution: follow the code across the package
boundary and say in a comment why. **Four things break, not two:**

1. `"guards order.cancelled and booking.confirmed on the previous status"` —
   re-point wholesale at the commerce file. The guards must still be asserted;
   only their location changes.
2. `"emits the four seller-driven order events"` — two of the four move and two
   stay. Split it or read a join; do not drop the two that moved.
3. **`ALL_SOURCES` (the five-file join near the top).** Add the commerce file.
   Miss this and `"has an emit site for every event in the catalogue"` fails
   for exactly the two events you moved — the test whose whole job is catching
   a name with nothing behind it.
4. **`"wraps every emit on a request path in after()"`** — the substantive one.
   `after()` is Next's and does not exist in a package. Follow the precedent
   the router already set for `publishShopEvent`: *"Awaited rather than
   deferred — there is no `after` outside Next's request scope."* That is sound
   here because `emitOrderWebhook` inserts into `webhookDeliveries`; it is a
   queue write, not the HTTP call. `deliver.ts` and the cron do the POSTing.
   Assert in commerce that the emit is awaited **after** the business write
   commits — which is the property the `after()` rule was really protecting —
   and leave the web files still asserting `after()`.

Do not weaken an assertion to make it pass. Every property that file protects
must still be protected somewhere.

**1b — the booking email. Blocked on A16, and that is fine.**
`docs/mobile/A16-email-package.md` extracts email into `packages/email` and
publishes the send seam you call. Until it lands, **narrow** the `KNOWN GAP`
comment in the router to name exactly what remains — the buyer email only, not
the webhooks you just fixed — rather than deleting it. A comment that overstates
a gap is as misleading as one that hides it.

After 1a, mobile fires the same webhooks as web. That is half the live bug
closed, cleanly, with no 3,000-line detour.

`packages/api/src/router.ts` documents its own gap, verbatim:

> KNOWN GAP, and it is a real one. apps/web does three further things this
> does not: it emails the buyer a booking decision, emits the
> `order.cancelled` / `booking.confirmed` webhooks, and revalidates the
> storefront cache. […] So a seller who confirms an *appointment* from the
> phone leaves the buyer un-emailed, where the same click on the web would
> have told them.

That is shipped today. Lift the email and webhook emission into
`@sailo/commerce` alongside `applyOrderStatus`. Leave `revalidatePath` behind
an **optional callback** the web action passes and mobile does not — Next's
request scope does not exist off-server, which is why it was never lifted.

Read `apps/web/src/lib/actions/order-status.ts` for what web actually does, and
`packages/commerce/orders.ts` for where it lands.

### Commit 2 — extract `saveProduct`

`apps/web/src/lib/actions/products.ts:147` is the most entangled function in
the repo: FormData parsing, auth, the domain write, and revalidation in one
body. Split the domain write into `@sailo/commerce`; leave the Server Action a
thin shell that parses, authorises, calls, and revalidates.

The existing web tests are your net. They must be green at **every** commit,
not just the last.

Same treatment for `deleteProduct`, `toggleProductPublished`.

### Commit 3 — tickets and door passes

Domain half of `actions/tickets.ts` and `lib/door-pass.ts` into
`@sailo/commerce`: `admitByCode`, `admitByTicket`, `undoAdmission`,
`addWalkUp`, `revokeAdmission`, `readDoorPass`, `touchDoorPass`. FormData half
stays in web.

## Procedures to expose

| Procedure | Notes |
|---|---|
| `products.save` | create + update, images, variants, files |
| `products.togglePublished` | |
| `products.delete` | |
| `products.list` | **extend** existing: cursor, search, status filter |
| `orders.list` | **extend** existing: cursor, status filter, search |
| `events.list` | from `shopEvents` |
| `events.door` | from `eventDoorStats` + `eventDoorList` |
| `tickets.admit` | **must take an idempotency key** |
| `tickets.undoAdmission` | |
| `tickets.addWalkUp` | |

## Details that must not be missed

- **`tickets.admit` needs an idempotency key.** A10 builds an offline queue
  that replays scans on reconnect. A double-admit at a venue door is a
  real-world failure with an angry human attached. Dedupe server-side on the
  key, and make replaying an identical admit a no-op that returns the original
  result rather than an error.
- **`orderItems` is authoritative**, not the order header. The header's
  `productTitle`/`quantity` are a summary of the first line — the router
  already says so. Anything that reads "what was bought" reads `items`.
- **Money invariants hold here too:** claims are conditional UPDATEs with the
  ceiling in the `WHERE`, order *lines* not order headers, blank ≠ zero. A
  blank variant price means "same as the product" and a blank stock means
  "nobody is counting" — those rules live in `@sailo/core/variants` and must
  not be re-derived.
- `applyOrderStatus` already handles the inventory cascade and ticket voiding.
  Do not reimplement any of it; you are moving side effects *around* it.
- Cursor pagination must be **keyset**, not offset — orders and products are
  ordered by `createdAt desc` and offset paging skips rows when a new order
  lands mid-scroll.
- Every list stays scoped by `ctx.shopId` in the `WHERE`. Search input is a
  filter, never a way to reach another shop's rows.
- `publishShopEvent(ctx.shopId, "order")` is awaited in the existing
  `updateStatus` deliberately — there is no `after()` outside Next. Keep that.

## Done when

- [ ] Confirming a booking through tRPC sends the same buyer email and fires
      the same webhooks as the web action. **Test proves it.**
- [ ] A product created through `products.save` is row-identical to one created
      through the web form, compared field by field.
- [ ] Replaying an identical `tickets.admit` admits once and returns the
      original result.
- [ ] All 1,730 web tests green at **every commit** in the branch.
- [ ] Keyset pagination returns no duplicates and skips no rows when a write
      lands mid-page. Test it.
- [ ] `pnpm turbo typecheck && pnpm turbo test && pnpm turbo lint && pnpm knip`.

## Handoff

PR states: the idempotency key's shape and dedupe window (A10 depends on it),
the cursor format (A07, A08 depend on it), and confirmation that the
`revalidatePath` callback seam leaves web behaviour unchanged.
