# The reviewer's account

A reviewer who opens the app, sees an empty state and cannot get past it
rejects the build. Not out of malice — they have twenty minutes and no way to
tell "nothing here yet" from "broken". So the account App Review signs in with
has to be a shop that already happened.

The credentials and the notes are in `store.config.json` under `apple.review`;
`eas metadata:push` writes them to App Store Connect. This file is why they are
what they are, and what has to exist behind them.

## The account

**`review@sailo.store`.** A dedicated seller account, not the `demo@sailo.store`
one `apps/web/scripts/seed.ts` creates. Two reasons they must stay separate:
the demo shop is what the e2e suite and the admin tour run against, so its
contents churn under a reviewer mid-session; and its password is in the repo
and has been for a long time.

`demoPassword` in `store.config.json` is `REPLACE_BEFORE_FIRST_SUBMIT` on
purpose. Set it when the account is created, rotate it after each review cycle,
and treat it as what it is: a live production login that will sit in App Store
Connect and in this file. It gets a shop with nothing real in it for exactly
that reason.

`demoRequired: true`, because none of the app is reachable signed out.

## What the shop must contain

The reviewer's twenty minutes have to land on populated screens, whichever tab
they open first. Minimum:

| Screen | Needs |
|---|---|
| Home | A shop with a name, a handle and a logo, so the onboarding checklist is mostly done rather than blank. Some takings in the last 7 days. |
| Orders | At least 8 orders across the statuses, spread over the last 30 days, each with 1–3 lines, a buyer name, a delivery method and totals. At least one still open, so the status control does something. |
| Store | At least 6 published products, at least two with photos, at least one with variants that price and count separately, at least one out of stock. |
| Insights | Enough visits and orders over 30 days that no chart is empty. |
| Check-in | **A live event** — a product with a future date — and at least 20 issued `tickets` rows in `valid` status, plus a few already `used`, so the scanner has something to scan and the door list is not blank. |

That last row is the one most likely to be skipped and the one most likely to
matter: check-in is the reason a seller installs a native app rather than
opening the site, so it is the feature a reviewer is most likely to probe.
`packages/db/src/schema/orders.ts` has the shape — a ticket is one row per
admission with its own `code`, and `status` is `valid` until the door claims
it. Issue a handful with `source: "manual"` so they are valid without a paid
order behind them.

**Seed it from a script, not by hand.** A hand-built shop cannot be recreated
when the review cycle comes round again with the password rotated and the data
six months stale. The pattern is already there in `apps/web/scripts/seed.ts`
and `seed-demos.ts` — idempotent, wipes and recreates only its own shop, never
touches `/demo` or a real seller's. Writing that script is outside this work
order's paths; it is item 5 in the README's blocked list.

## What the notes tell them

`store.config.json`'s `apple.review.notes` is the field that answers questions
before they become rejections. It says four things, and each is there because
of a specific failure:

1. **A numbered walk-through of the five tabs**, so a reviewer never has to
   guess what the app is for. Sailo is a seller tool; a reviewer expecting a
   shopping app will look for a cart and conclude the app is broken.

2. **"There is no purchase anywhere in this app."** Stated plainly, because a
   reviewer who finds subscription tiers on sailo.store and then opens the app
   is right to check. Saying it first is cheaper than answering it later.

3. **"Stripe Connect is not a purchase."** The single most likely
   misunderstanding. Settings offers to connect a Stripe account; that is a
   seller onboarding their own business so their buyers can pay *them*, and
   the flow opens Stripe's hosted pages in a browser. Without that sentence it
   reads like an unlabelled payment flow.

4. **Where account deletion is, and not to confirm it.** Guideline 5.1.1(v)
   means a reviewer will go looking for it, and the demo account is the one
   they will be holding when they find it.

## Verifying it

The check that matters is the one in the work order: **someone who has not
seen the app** signs in with the credentials from `store.config.json`, on a
TestFlight build, and works through the notes in order. Not the person who
wrote the app, and not from a simulator with a dev server running.

They are looking for one thing: a screen where they get stuck. Every place
that happens is a place App Review gets stuck too.
