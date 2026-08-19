# 37 — Seller team members and roles

**Priority:** P1 · **Effort:** M · **Depends on:** nothing · **Blocks:** nothing

> **Rewritten 2026-08-19 to build on Better Auth's organization plugin** rather
> than on three hand-rolled tables. The owner's call, and it is the right one:
> the plugin ships members, invitations, roles and an access-control model that
> this spec was about to write from scratch, and Sailo already runs Better Auth
> with three plugins. The original hand-rolled data model is at the end, kept
> as the record of what was considered.

## What

A seller adds the people who work with them, and decides what each can do. A
shop assistant handles orders and never sees payouts; a bookkeeper sees payouts
and never edits products.

## What the plugin gives us, and what is left to build

`better-auth/plugins/organization` is installed today as a transitive part of
the library. It provides:

| | |
|---|---|
| `organization` | the team a shop belongs to |
| `member` | a person in it, with a role |
| `invitation` | invite by email, accept, expire, revoke |
| `team` / `teamMember` | sub-teams — **not used in v1**, see below |
| `createAccessControl`, `hasPermission` | the permission model and the check |

So this spec does **not** write `shop_roles`, `shop_members`, an invitation
token, an expiry, an acceptance flow, or a permission evaluator. All of that is
the plugin's, it is tested upstream, and it is the half most likely to be got
subtly wrong by hand — an invite token with no expiry, a revoked member whose
session outlives the revocation.

**What is left is the part that is genuinely ours:**

1. Deciding what the permissions *are*, in Sailo's vocabulary.
2. Attaching a shop to an organization.
3. Making `requireShop()` enforce a permission — and auditing every call site.
4. The settings screen.

Item 3 is still the risk. It is the whole of the risk now.

## The permission statements

`createAccessControl` takes a statement map — resources, and the actions on
each. Keep it **small and named after what a seller thinks they are doing**, not
after tables:

```ts
const statement = {
  products:  ["read", "write"],
  orders:    ["read", "write", "refund"],
  customers: ["read", "export"],
  marketing: ["read", "send"],
  money:     ["read"],          // payouts, invoices, the tax report
  settings:  ["read", "write"], // rails, shipping, legal pages, the shop itself
  team:      ["read", "write"], // inviting people
} as const;
```

Three roles ship, built from those statements:

- **Owner** — everything, including `team:write` and `settings:write`. Cannot be
  removed and cannot be demoted; a shop with no owner is unrecoverable.
- **Manager** — everything except `team`, `money` and `settings:write`.
- **Staff** — `products:read`, `orders:read`, `orders:write`, `customers:read`.

A seller may not define their own roles in v1. Custom roles are a screen, a
validator and a migration path for every future permission; three named roles
answer the actual request, which is *"let my assistant handle orders."*

**`refund` and `export` are separate actions on purpose.** They are the two a
seller most often wants to withhold, and folding them into `write` and `read`
would make the roles useless for the case they exist for.

## Attaching a shop to an organization

`shops.userId` is the owner today, with a unique index — one shop per user.
That stays true and is not what changes.

Add `shops.organizationId`, and create an organization when a shop is created.
**Backfill every existing shop with an organization whose only member is the
current owner**, in the migration, so no shop is ever in a state where nobody
can administer it.

`shops.userId` remains the owner of record. It is what account deletion (spec
03), the closure record, and every existing ownership check already read, and
re-pointing all of that at membership is a second tree-wide change for no gain.
**The organization decides who else may act; `userId` still decides whose shop
it is.**

## `requireShop()` gains a permission — the risky part

```ts
const { shop, member } = await requireShop("orders:refund");
```

> ### Make the argument required. Do not default it.
>
> A call site that still compiles because the parameter was optional is a hole
> that shipped, and it will compile silently across a hundred files. Required,
> and the compiler enumerates the work for you.
>
> **Count the call sites and write the number down.** `PRODUCTION-PLAN.md` did
> exactly that for 32 actions and 20 HQ queries, and that number is what lets
> the next person verify the audit was complete rather than plausible.

There is a precedent in the tree for what *enforced* means: every HQ write names
a `StaffCapability`, and a bare `requireStaff()` was the hole that shipped once.
Read `apps/hq/src/lib/` before designing the seller-side shape.

**Land this alone, when the tree is quiet.** It touches nearly every server
action, so landing it mid-flight turns every other agent's branch into a
conflict in files they never opened.

## The audit trail

Keep the original spec's third table — the plugin does not provide one:

```
shop_member_actions  id, shop_id, actor_email text, action text,
                     subject_type text, subject_id text, detail jsonb,
                     created_at
                     idx (shop_id, created_at)
```

Append-only, like every ledger here. It is what answers *"who refunded that?"*,
which is the first question asked the first time a team member does something
surprising.

## Details that must not be missed

- **The invite endpoint is an account oracle.** Decision B: it **fails closed**,
  and it answers the same sentence whether or not that address already has a
  Sailo account. `{ onOutage: "closed" }`.
- **Revocation must end the session, not just the row.** A removed member with a
  live cookie is still a member until it expires. The plugin's session handling
  is the seam; verify it, do not assume it.
- **Plan gate.** Teams are a paid feature — `packages/core/src/shop/plans.ts`,
  with the existing upgrade-modal pattern. The Free plan gets the owner alone.
- **`team` / `teamMember` are unused in v1.** The plugin offers sub-teams inside
  an organization; a Sailo shop is one team. Leave the tables unused rather than
  inventing a use — an unused table is cheaper than a concept nobody asked for.
- **Better Auth's own `admin` plugin is not this.** That is platform staff, and
  Sailo's staff model is `StaffCapability` in apps/hq. Do not conflate them.
- 35 locales for the settings screen, the three role names and their
  descriptions, and the invitation email.

## Testing

**Unit:** each role's statement map grants exactly what it should and nothing
more; the owner cannot be demoted or removed.

**Scenario:** an invited member accepts and can do their role's actions and not
others; a revoked member's next request is refused; `orders:refund` withheld
means a refund action fails for a manager and succeeds for the owner; the
audit trail records the actor, not the shop.

**Browser:** the settings screen, and one action attempted by a member who lacks
the permission — the refusal must be a refusal, not a blank screen.

## Done when

A seller can invite somebody, choose what they can do, and see what they did;
every seller-facing write names a permission; the call-site count is written
down; and a revoked member is out immediately.

---

## Appendix — the original hand-rolled model, superseded

Kept as the record of what was considered before the plugin was chosen. Do not
build this.

```
shop_roles     id, shop_id → shops(cascade), name text,
               permissions jsonb not null,   -- string[] of permission ids
               is_default boolean default false,
               created_at, updated_at
               unique (shop_id, name)
               unique (shop_id) WHERE is_default   -- one default, enforced

shop_members   id, shop_id → shops(cascade),
               email text not null,           -- lowercased
               name text,
               role_id → shop_roles(restrict),
               invited_by_email text, invited_at,
               accepted_at, revoked_at,
               invite_token_hash text, invite_expires_at,
               created_at
               unique (shop_id, email)
               idx (email) WHERE revoked_at IS NULL
```

The reason it is superseded is not that it was wrong — it is that every line of
it is a thing the plugin already does, tested, including the two that are easy
to get subtly wrong: an invitation that expires, and a revocation that takes
effect immediately.
