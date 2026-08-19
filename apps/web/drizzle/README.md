# Migrations

Hand-written SQL, applied by a human. That is a deliberate choice and not a gap
waiting to be filled with tooling — but it only works if the rules below hold,
so `src/lib/migrations.test.ts` enforces them.

## What applies these files

Nothing automatic. There is no `migrate()` call anywhere in the workspace and
no `meta/_journal.json`, because drizzle does not manage this directory.

**`pnpm db:push` does not apply these files.** It runs `drizzle-kit push`, which
introspects the live database, diffs it against `packages/db/src/schema`, and
applies *its own* generated statements. The two are independent. Push is what
keeps column definitions in step during development; these files are for
everything push cannot express — partial and expression indexes, exclusion
constraints, partitions, backfills, and anything that needs to run in a
particular order against existing rows.

So the sequence when adding schema is:

1. Change `packages/db/src/schema`.
2. `pnpm db:push` to move development forward.
3. If the change needs anything push cannot express, add a numbered file here.
4. Apply it to each environment yourself, and note that you did.

## Naming

`NNNN_lower_snake_name.sql`, zero-padded to four digits, numbered from the
current maximum. The test rejects anything else.

### Three numbers are used twice

`0007`, `0008` and `0012` each name two files. They were written in parallel on
separate branches and merged without anyone renumbering, so the order *within*
each pair is not recorded anywhere.

This has not caused a problem because the pairs touch unrelated tables —
`0007_affiliate_payout` and `0007_shop_pixels` share nothing, and neither do the
other two pairs. Renumbering them now would be worse than leaving them: the
numbers are the only handle anyone has on what was already applied where, and
rewriting that record to make a linter happy would destroy the one thing it is
good for.

They are grandfathered explicitly in the test. A **fourth** collision fails.

## Re-running

Every file is safe to re-run *except* for foreign keys and check constraints.

`CREATE TABLE`, `CREATE INDEX`, `CREATE TYPE` and `ADD COLUMN` all carry
`IF NOT EXISTS` throughout, so applying them twice is a no-op. Postgres has no
`IF NOT EXISTS` for `ALTER TABLE ... ADD CONSTRAINT`, and four early files add
constraints bare:

| File | Unguarded constraints |
| --- | --- |
| `0004_booking_overlap.sql` | 1 |
| `0006_event_tickets.sql` | 3 |
| `0012_bookings_and_audience.sql` | 7 |
| `0013_lifecycle_emails.sql` | 1 |

Re-running one of those against a database that already has the constraint
stops with `constraint ... already exists`. Everything before the failing
statement has already been applied, so it is not destructive — but it does mean
you cannot simply replay the whole directory to bring a fresh environment up.

From `0015` onwards the practice is already the right one: wrap the statement so
a second run is a no-op.

```sql
DO $$ BEGIN
  ALTER TABLE "orders"
    ADD CONSTRAINT "orders_subscription_id_subscriptions_id_fk"
    FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
```

The test requires that form for every **new** migration. The four files above
are grandfathered, because they are already applied everywhere that matters and
rewriting SQL that cannot be tested from here is a worse trade than recording
the debt. Converting them is safe to do at a keyboard with a scratch database
in front of you; it is not safe to do blind.

## Knowing what is applied where

There is no record, and that is the honest gap in this setup — the way it was
last found out was by querying production directly to discover `0022` had never
been applied.

Two ways out, when it becomes worth the time:

- **Adopt drizzle's journal.** `drizzle-kit generate` maintains
  `meta/_journal.json` and `drizzle-kit migrate` applies what is missing against
  a `__drizzle_migrations` table. This is the real fix, and the cost is a
  one-off reconciliation: mark all 22 as applied in every existing environment
  before the first automated run, or it will try to replay them.
- **Make the whole directory replayable first.** Convert the 12 constraints
  above, and then "apply everything" becomes a safe, boring operation that needs
  no record at all.

The second is a prerequisite for trusting the first.
