# 30 — Email Automations (flows)

**Priority:** P0 · **Effort:** XL · **Depends on:** 34 (lists, for the
`list.joined` trigger) · **Blocks:** 32, 33, 35, 40 (each is a trigger source)

## What

A seller builds a sequence once and it runs on its own: a trigger enrols a
contact, then steps send mail, wait, split and filter. Reference: Easytools
Campaigns → Automations, whose shape is documented to the field level in
`llms-full.txt` §`automation-triggers` / `automation-actions`.

This is the gap `docs/specs/README.md` names three times in the spec-14 notes:
**"*Not built:* flows."**

Sailo already sends behaviour-triggered mail — `@sailo/marketing/lifecycle`,
twelve rungs, anchored, re-checked, expiring — but only *Sailo → seller*.
This is *seller → buyer*, and it is the same idea with the decisions moved
into rows because a seller cannot open a pull request. See
`GAP-2026-08-easytools.md` §3.2 for why both must exist and why nothing here
may migrate the twelve rungs.

## Build on what exists — do not reinvent any of it

| Need | Use | Do not |
|---|---|---|
| Trigger/filter vocabulary | `marketing/broadcasts/segments.ts` (19 rule types, browser-safe) | write a second rule language |
| Rule → SQL | `broadcasts/segment-sql.ts` (correlated EXISTS over the consent floor) | filter after the consent floor |
| Durable step claim + retry | the lease in `workflows/src/webhooks/{claim,attempt,policy}.ts` | invent a queue |
| Send, quota, suppression | `broadcasts/{send,quota,reputation}.ts`, `email_suppressions` | bypass suppression |
| Markdown → Gmail-safe HTML, merge tags | `broadcasts/markdown.ts` | emit bare `<p>` |
| Anchors, re-check at send, expiry | the three rules at the top of `lifecycle/steps.ts` | chain a delay off the previous send |

## Data model (migration, production first)

`drizzle/NNNN_automations.sql`. Five tables, one shared with spec 31.

```
automations          id, shop_id → shops(cascade), name, kind text
                     ('email'|'scenario' — 31 reuses this table),
                     status text ('draft'|'active'|'paused') default 'draft',
                     trigger jsonb, graph jsonb, entry_policy text
                     ('once'|'repeat') default 'once',
                     activated_at, created_at, updated_at
                     idx (shop_id, kind, status)

automation_emails    id, automation_id → automations(cascade), name, subject,
                     preheader, body_md, from_address, reply_to, position,
                     created_at, updated_at

automation_runs      id, automation_id → automations(cascade),
                     client_id → clients(set null),
                     subscriber_id → newsletter_subscribers(set null),
                     email text not null,              -- the durable identity
                     status text ('queued'|'waiting'|'done'|'failed'|'cancelled'),
                     cursor text,                      -- current node id
                     wake_at timestamp,                -- null unless waiting
                     attempt int default 0,
                     entered_at, finished_at, last_error text
                     idx (automation_id, status, wake_at)
                     unique (automation_id, email) WHERE entry_policy = 'once'
                       -- as a partial index on a generated column, or enforce
                       -- in the claim; see "Details"

automation_steps     id, run_id → automation_runs(cascade), node_id text,
                     kind text, entered_at, left_at, outcome text,
                     delivery_id → broadcast_deliveries(set null)
                     idx (run_id, entered_at)
```

`graph` is `{ nodes: Node[], edges: Edge[] }`. A `Node` is
`{ id, kind, config }` with `kind` one of `send | timer | branch | filter`.
Validate on save with a zod schema in `packages/marketing/src/automations/graph.ts`
and **again at claim time** — a graph edited while runs are in flight is normal,
and a cursor pointing at a deleted node must fail the run, not crash the tick.

### Why `email` is a column and not only a foreign key

A run must survive its contact. `client_id` is `set null` on delete and a buyer
exercising deletion (spec 03) must not strand or resurrect a sequence. The
address is what the run is *about*; the ids are how it personalises. Every
suppression check keys on `email`.

## Triggers (v1 — four, matching theirs)

| Trigger | Fires from | Config |
|---|---|---|
| `list.joined` | 34's list-membership write | list id |
| `contact.updated` | `clients` update path | which fields, optional segment |
| `product.purchased` | the same emit points as `order.paid` in spec 16 | product ids, or any |
| `waitlist.signup` | spec 33 | product id, or any |

`entry_policy` matches theirs exactly: `once` means a contact never re-enters;
`repeat` means they may, **but not while a run is live** — enforced by the
partial unique index plus a `status IN ('queued','waiting')` guard in the
enrol path.

Enrolment is a **write, not a poll**: each emit point calls
`enrolIfMatching(shopId, trigger, subject)`. A cron that scanned for newly
matching contacts would re-enrol everybody the first time any predicate changed.

## Steps (v1 — four, matching theirs)

- **send** — one `automation_emails` row. Renders through `broadcasts/render.ts`
  and `markdown.ts` unchanged, writes a `broadcast_deliveries` row so opens,
  clicks, bounces and complaints all land in the ledger that already exists.
- **timer** — four modes, theirs: a duration, an absolute datetime, the next
  time-of-day, the next day-of-week. Sets `wake_at` and `status = 'waiting'`.
- **branch** — ≥2 paths. Conditions: `contact matches / does not match
  segment` (reuses `segment-sql.ts`), `email opened / not opened`,
  `link clicked / not clicked` (both read `broadcast_deliveries`).
- **filter** — one segment; non-matching runs stop (`done`, outcome
  `filtered`). Not a branch: no second path. Their distinction, and it is the
  right one — a filter is "only these people continue".

## The runner

`packages/workflows/src/automations/tick.ts`, on the existing cron cadence.

1. Claim due runs with **the same conditional UPDATE the webhook lease uses** —
   `wake_at <= now()`, bump `attempt`, push `wake_at` forward by the retry
   policy, `RETURNING`. A tick that dies mid-send leaves a row that becomes due
   again; at-least-once with a dedupe key is the contract, exactly as
   `webhooks/attempt.ts` documents.
2. Load the graph, read `cursor`, execute one node, write an
   `automation_steps` row, set the next `cursor`/`wake_at`.
3. **One node per tick.** Not a loop to completion: a graph with a cycle would
   otherwise hold the tick for ever, and a per-node row is what makes the
   metrics screen possible.

Eligibility is re-checked **at send time**, never at enrol time — rule 2 of
`lifecycle/steps.ts`, and here it means the consent floor, the suppression
list and the plan flag are all asked immediately before the send.

## Metrics (their Analytics / Runs tabs)

Per automation: total runs, currently queued, completed, failed. Per email:
subject, recipients, open rate, click rate, unsubscribes — all already
computable from `broadcast_deliveries`, no new counters. Per run: the
`automation_steps` timeline, which is what makes "why did this contact stop"
answerable. Active automations render live counts per node from
`automation_runs.cursor`.

## Details that must not be missed

- **Unsubscribe scope is per-automation, and theirs is worth copying:** an
  unsubscribe from an automation email stops *that automation* for ever, even
  on re-entry, and does **not** remove the contact from any list. Store it as
  a suppression row scoped to the automation, not a list mutation. A global
  unsubscribe still wins over everything.
- **Every automation email carries the RFC 8058 one-click header**, through the
  same signing path as broadcasts. Tokens are signed under their **own** domain
  string — a broadcast token must not cancel an automation and vice versa, the
  rule already applied to lifecycle vs broadcast tokens.
- **Quota:** automation sends count against the same per-shop and platform-wide
  daily ceilings as broadcasts (`BROADCAST_DAILY_CEILING`). A flow that hits
  the ceiling **waits** — `wake_at` tomorrow — it does not fail and does not
  silently skip. Skipping a step in a funnel is the failure mode that looks
  like nothing happened.
- **Plan gate:** `automations` in `packages/core/src/shop/plans.ts`, Business.
  A seller who downgrades has active flows **paused**, not deleted, with the
  runs preserved — the broadcasts downgrade rule ("gets their drafts back, not
  their sends").
- **`repeat` needs a floor.** Without a minimum re-entry interval a
  `contact.updated` trigger on a field the flow itself writes is an infinite
  loop that mails somebody hourly. Refuse a graph whose own steps write a
  field its trigger watches, and cap re-entry at once per 24h.
- **Timezone.** `time of day` and `day of week` are wall-clock in
  `shops.timeZone`, the column that already makes booking mean anything. UTC
  would mail a Sydney seller's list at 3am.
- **A paused automation's waiting runs keep their `wake_at`** and resume on
  activation. Their UI requires a pause before editing an active flow; do the
  same, because it makes the cursor-into-deleted-node case rare rather than
  routine.
- **Deleting an automation** must not cascade away the delivery ledger — the
  `broadcast_deliveries` rows are reputation evidence. `automation_steps`
  references them `set null`; the deliveries outlive the flow.
- 35-locale strings for the builder, the trigger names, the step names, the
  branch conditions and the metrics labels. This is the single largest string
  addition in the plan — see `GAP-2026-08-easytools.md` §6 and Decision A.

## Testing

Unit (pure, from object literals — the whole point of keeping the graph
serialisable): graph validation rejects a branch with one path, a cycle
without a timer, a node id not in `edges`, and a cursor pointing nowhere;
timer arithmetic for all four modes across a DST boundary in a non-UTC
`shops.timeZone`; branch evaluation for each of the six conditions.

Scenario (real database): enrol → timer → send → branch → filter end to end;
two concurrent ticks claim one run **once** (the lease, same shape as the
webhook race); `entry_policy = 'once'` refuses the second enrolment; a
suppressed address is skipped at send time, not at enrol time; a global
unsubscribe stops every automation and a per-automation unsubscribe stops
one; quota exhaustion defers rather than drops; a graph edited mid-run fails
that run and does not crash the tick; a downgrade pauses and preserves.

## Done when

A seller builds trigger → send → wait → branch → send, activates it, and a
real contact walks it; every send is consented, suppressed-checked, quota-
counted and one-click unsubscribable; two ticks never double-send; the metrics
screen answers "how many are waiting where, and why did this one stop"; and
`lifecycle/steps.ts` is untouched.
