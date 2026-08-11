import { planFor } from "@/lib/plans";
import type { LifecycleState } from "./state";

/**
 * The ladder: every email Sailo sends a seller about Sailo, in the order a
 * seller climbs it, and the rules that decide which rung they are on.
 *
 * Pure on purpose — no database, no mail, no `server-only`. Everything here
 * takes a `LifecycleState` and answers a question about it, so the whole
 * pipeline's behaviour is testable from object literals and the send pass has
 * nothing to decide.
 *
 * THREE RULES, and each exists because of a specific way this kind of
 * pipeline goes wrong:
 *
 *   1. **An anchor is a real timestamp**, never "N days after the last email".
 *      A drip chained off its own previous send drifts the moment a step is
 *      skipped, and every step here can be skipped — that is what a funnel
 *      is. Each rung is a fixed offset from something that actually happened:
 *      the signup, the shop, the first product, the first sale.
 *
 *   2. **Eligibility is re-checked at send time**, not at schedule time. The
 *      seller who was mailed "add your first product" ten minutes after
 *      adding one is the failure this prevents, and it is only preventable by
 *      asking the question late.
 *
 *   3. **Every rung goes stale.** Without an expiry the first tick after
 *      deployment tells a seller of six months' standing that their shop is
 *      live, and tells someone who sold out last spring that they should try
 *      getting their first order. A rung whose moment has passed is not sent
 *      late; it is not sent. `catch_up` is the one rung with no expiry, and
 *      it exists precisely to say something true to the people every other
 *      rung has gone stale for.
 */

export const LIFECYCLE_STEP_IDS = [
  // Signed up, no shop. The most valuable branch and the shortest one.
  "no_shop_1",
  "no_shop_2",
  "no_shop_3",
  // Shop exists.
  "shop_live",
  "no_product_1",
  "no_product_2",
  // Something to sell, no way to be paid for it.
  "no_rail",
  // Ready to sell, nobody has bought yet.
  "no_orders_1",
  "no_orders_2",
  // Converted.
  "first_sale",
  "upgrade",
  // Everyone the rungs above have gone stale for.
  "catch_up",
] as const;

export type LifecycleStepId = (typeof LIFECYCLE_STEP_IDS)[number];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type LifecycleStep = {
  id: LifecycleStepId;
  /**
   * The earliest moment this rung may be sent, or null when the thing it is
   * anchored to has not happened yet.
   */
  dueAt: (state: LifecycleState) => Date | null;
  /** Whether the rung is still describing this seller's actual situation. */
  applies: (state: LifecycleState) => boolean;
  /**
   * How long after `dueAt` the rung stays worth sending. Null means forever,
   * which only `catch_up` gets.
   */
  staleAfterMs: number | null;
};

/** Whether money can reach this seller at all — the checklist's own test. */
export function canTakeMoney(state: LifecycleState): boolean {
  return state.railCount > 0 || Boolean(state.shop?.stripeChargesEnabled);
}

/** Set up enough to sell: a shop, something in it, and a way to be paid. */
export function isSellable(state: LifecycleState): boolean {
  return Boolean(state.shop) && state.productCount > 0 && canTakeMoney(state);
}

const at = (anchor: Date | null | undefined, offsetMs: number) =>
  anchor ? new Date(anchor.getTime() + offsetMs) : null;

/**
 * When a seller became able to sell, as closely as the data can say.
 *
 * The first product, not the shop and not the rail. There is no "rail enabled
 * at" column to read, and inventing one would be storing a fact to answer a
 * question that only needs an approximation — the `applies` test below does
 * the real work by demanding the rail still be there at send time. A seller
 * who adds the product on day one and the rail on day thirty is simply due
 * this rung the moment the rail lands, which is the right moment anyway.
 */
const readyAt = (state: LifecycleState) => state.firstProductAt;

export const LIFECYCLE_STEPS: LifecycleStep[] = [
  /* ---------------------------------------------------------------- no shop */
  /*
   * Two hours, not two minutes. Sign-up already sends a confirmation email,
   * and onboarding drops the seller straight into the shop form — most of
   * them are still in it. A "you haven't finished" nudge that arrives while
   * somebody is halfway through the thing it is nagging about is the fastest
   * way to teach them our mail is noise.
   */
  {
    id: "no_shop_1",
    dueAt: (s) => at(s.signedUpAt, 2 * HOUR),
    applies: (s) => !s.shop,
    staleAfterMs: 30 * DAY,
  },
  {
    id: "no_shop_2",
    dueAt: (s) => at(s.signedUpAt, 2 * DAY),
    applies: (s) => !s.shop,
    staleAfterMs: 30 * DAY,
  },
  /*
   * The last one, and it says so in the copy. A pipeline that never admits
   * it has finished is a pipeline people report as spam — and the promise
   * "this is the last email about this" is only worth making if the ladder
   * has no further rung for somebody who never built a shop. It has not.
   */
  {
    id: "no_shop_3",
    dueAt: (s) => at(s.signedUpAt, 9 * DAY),
    applies: (s) => !s.shop,
    staleAfterMs: 30 * DAY,
  },

  /* ------------------------------------------------------------- shop built */
  /*
   * The one rung that is not a nudge. It carries the seller's public link,
   * which is the single thing they most want in a place they can find again,
   * and it goes to everybody who builds a shop rather than only to the ones
   * who stall. Twenty minutes so it does not race the seller still clicking
   * through their own new admin, and stale after three days because "your
   * shop is live" said a week late reads as a system that was asleep.
   */
  {
    id: "shop_live",
    dueAt: (s) => at(s.shop?.createdAt, 20 * 60_000),
    applies: (s) => Boolean(s.shop),
    staleAfterMs: 3 * DAY,
  },
  {
    id: "no_product_1",
    dueAt: (s) => at(s.shop?.createdAt, 2 * DAY),
    applies: (s) => Boolean(s.shop) && s.productCount === 0,
    staleAfterMs: 30 * DAY,
  },
  {
    id: "no_product_2",
    dueAt: (s) => at(s.shop?.createdAt, 8 * DAY),
    applies: (s) => Boolean(s.shop) && s.productCount === 0,
    staleAfterMs: 30 * DAY,
  },

  /* ------------------------------------------------------------- no payment */
  /*
   * A shop with something in it that nobody can pay for. The most expensive
   * gap in the funnel, because the seller believes they are open.
   *
   * "Paid" here means any enabled rail — cash on delivery, a bank transfer, a
   * WhatsApp handoff — and not Stripe. A seller in a market where nobody
   * takes cards is fully set up without it, and telling them otherwise is
   * telling them their working shop is broken.
   */
  {
    id: "no_rail",
    dueAt: (s) => at(s.firstProductAt, 1 * DAY),
    applies: (s) =>
      Boolean(s.shop) && s.productCount > 0 && !canTakeMoney(s),
    staleAfterMs: 30 * DAY,
  },

  /* ------------------------------------------------------------- no traffic */
  {
    id: "no_orders_1",
    dueAt: (s) => at(readyAt(s), 3 * DAY),
    applies: (s) => isSellable(s) && s.orderCount === 0,
    staleAfterMs: 45 * DAY,
  },
  {
    id: "no_orders_2",
    dueAt: (s) => at(readyAt(s), 12 * DAY),
    applies: (s) => isSellable(s) && s.orderCount === 0,
    staleAfterMs: 45 * DAY,
  },

  /* -------------------------------------------------------------- converted */
  /*
   * A day after the sale, not a minute after. `seller-messages.ts` already
   * mails them the order itself the moment it lands; this is the other thing
   * worth saying, and saying both at once buries the one that matters.
   */
  {
    id: "first_sale",
    dueAt: (s) => at(s.firstOrderAt, 1 * DAY),
    applies: (s) => s.orderCount > 0,
    staleAfterMs: 5 * DAY,
  },
  /*
   * The only rung that asks for money, and it asks last, after three sales
   * have proved the shop works. Gated on the plan a seller is *entitled* to
   * rather than the `plan` column, so a comped account and a lapsed
   * subscription are each read correctly.
   */
  {
    id: "upgrade",
    dueAt: (s) => at(s.firstOrderAt, 14 * DAY),
    applies: (s) =>
      Boolean(s.shop) &&
      s.orderCount >= 3 &&
      planFor({
        plan: s.shop?.plan ?? "free",
        subscriptionStatus: s.shop?.subscriptionStatus ?? null,
        compPlan: s.shop?.compPlan ?? null,
      }).id === "free",
    staleAfterMs: 60 * DAY,
  },

  /* ---------------------------------------------------------------- backfill */
  /*
   * The rung for everyone the pipeline arrived too late for.
   *
   * On the day this ships there is a whole fleet of sellers whose every
   * anchor is months past, and the two obvious options are both bad: mail
   * them the stale ladder from the top, or write them off. This is the third
   * — one email, once, that reads their *current* state and names the one
   * thing standing between them and a sale.
   *
   * `sent.size === 0` is what makes it once and what keeps it out of the way:
   * a seller the pipeline has ever mailed cannot receive it, so it can never
   * interleave with the ladder, and a seller who receives it and then builds
   * a shop simply rejoins at `shop_live` on its own fresh anchor.
   *
   * No expiry, because its whole purpose is to be the thing that has not
   * expired.
   */
  {
    id: "catch_up",
    dueAt: (s) => at(s.signedUpAt, 14 * DAY),
    applies: (s) => s.sent.size === 0 && s.orderCount === 0,
    staleAfterMs: null,
  },
];

const BY_ID = new Map(LIFECYCLE_STEPS.map((step) => [step.id, step]));

export function lifecycleStep(id: LifecycleStepId): LifecycleStep {
  const step = BY_ID.get(id);
  // The map is built from the same array the ids are declared with, so this
  // is unreachable — it exists so callers get a step and not `undefined`.
  if (!step) throw new Error(`unknown lifecycle step: ${id}`);
  return step;
}

/**
 * The one rung this seller is due right now, or null.
 *
 * Ladder order decides ties, and ties are the normal case: a seller three
 * days in with a shop and no product satisfies `shop_live` and
 * `no_product_1` at once. Earliest-unclaimed-first walks them up the ladder
 * one rung per pass, in the order the story is meant to be told, rather than
 * jumping to whichever rung happened to become due most recently.
 */
export function nextLifecycleStep(
  state: LifecycleState,
  now: Date,
): LifecycleStep | null {
  for (const step of LIFECYCLE_STEPS) {
    if (state.sent.has(step.id)) continue;
    if (!step.applies(state)) continue;

    const due = step.dueAt(state);
    if (!due || due > now) continue;

    if (
      step.staleAfterMs !== null &&
      now.getTime() - due.getTime() > step.staleAfterMs
    ) {
      continue;
    }

    return step;
  }
  return null;
}

/**
 * The step id used for a tombstone, which is not a rung and has no copy.
 *
 * Deliberately outside `LIFECYCLE_STEP_IDS`, so it can never be looked up in
 * the drafts record and can never be mistaken for a message somebody
 * received. A row carrying it has `sentAt` null and an `error` saying what it
 * is; its only job is to occupy the unique index so the candidate query can
 * skip an account the pipeline has run out of things to say to.
 */
export const RETIRED_STEP = "retired";

/**
 * Whether an account should be tombstoned rather than read again next hour.
 *
 * Three conditions, and the third is the one that is easy to get wrong.
 * Nothing is due, and nothing ever has been — but a seller who signed up
 * yesterday also has nothing due yet, and retiring them would silently drop
 * them out of the pipeline on day one. So the last-chance rung's own moment
 * must already have passed: if `catch_up` is not yet due, this account is not
 * finished, it is early.
 */
export function isRetirable(state: LifecycleState, now: Date): boolean {
  if (state.sent.size > 0) return false;
  if (nextLifecycleStep(state, now)) return false;

  const lastChance = lifecycleStep("catch_up").dueAt(state);
  return Boolean(lastChance && lastChance <= now);
}

/**
 * What the catch-up email should point at: the first thing this seller has
 * not done. Also what the shape of the funnel is, named once so the copy and
 * the tests agree on it.
 */
export type LifecycleGap = "shop" | "product" | "rail" | "orders" | "none";

export function lifecycleGap(state: LifecycleState): LifecycleGap {
  if (!state.shop) return "shop";
  if (state.productCount === 0) return "product";
  if (!canTakeMoney(state)) return "rail";
  if (state.orderCount === 0) return "orders";
  return "none";
}
