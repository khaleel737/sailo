import type { Product, Subscription } from "@sailo/db/schema";
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  type SubscriptionStatus,
} from "@sailo/core/subscription-status";

/**
 * What a membership is, in rules rather than in Stripe calls.
 *
 * Pure and free of every server import, because the same three questions are
 * asked from a storefront panel, an admin list, a webhook and a download
 * route — and a rule that is answered differently in any one of those is a
 * member who can get in through one door and not another.
 *
 * The questions:
 *
 *   - Is this product sellable as a membership at all?
 *   - Is this subscription currently letting somebody in?
 *   - Has the seller changed the price since Stripe was told about it?
 */

/* --------------------------------------------------------------------------
   Intervals
-------------------------------------------------------------------------- */

/**
 * Stripe's four recurring intervals, all four of them.
 *
 * It was two — month and year — which was a guess about what sellers charge
 * rather than a constraint anything imposed. A weekly class, a fortnightly
 * box, a quarterly subscription: ordinary businesses, none of them sellable.
 * Stripe has always accepted all four, and pairing them with a count below is
 * exactly its model rather than one of ours.
 *
 * Ordered shortest first, which is the order a picker should offer them in.
 */
export const BILLING_INTERVALS = ["day", "week", "month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export function isBillingInterval(value: unknown): value is BillingInterval {
  return typeof value === "string" && (BILLING_INTERVALS as readonly string[]).includes(value);
}

/**
 * The most of each interval Stripe will put in one billing period.
 *
 * Stripe's rule is that a period may not exceed one year, expressed per
 * interval. Written down here rather than discovered at checkout, because the
 * seller is looking at the field now and the buyer would meet the error later
 * with nothing they can do about it.
 */
export const MAX_INTERVAL_COUNT: Record<BillingInterval, number> = {
  day: 365,
  week: 52,
  month: 12,
  year: 1,
};

/**
 * How many intervals per charge, with nonsense folded to one.
 *
 * One is the answer for absent, zero, a fraction and a negative, because all
 * four mean the same thing to a seller: they did not choose a number, and the
 * ordinary cycle is every one interval. Above the ceiling it clamps rather
 * than refusing — "every 400 days" is a typo for something, and the closest
 * legal cycle is a better answer than a saved product that cannot be bought.
 */
export function normalizeIntervalCount(
  raw: unknown,
  interval: BillingInterval = "month",
): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 1;
  const count = Math.trunc(n);
  if (count <= 1) return 1;
  return Math.min(count, MAX_INTERVAL_COUNT[interval]);
}

/**
 * A trial nobody has to think about.
 *
 * Zero and null are the same answer — "charge now" — and are folded to null
 * here because Stripe rejects `trial_period_days: 0` as a value while
 * accepting its absence. A seller typing 0 into a box means "no trial", not
 * "fail the checkout".
 */
export const MAX_TRIAL_DAYS = 365;

export function normalizeTrialDays(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const days = Math.floor(n);
  if (days <= 0) return null;
  return Math.min(days, MAX_TRIAL_DAYS);
}

/* --------------------------------------------------------------------------
   Who is doing the billing
-------------------------------------------------------------------------- */

/**
 * The two ways a membership can be kept paid up.
 *
 * `stripe` is a card on file: Stripe raises an invoice each period, charges
 * it, and tells us. `manual` is every other rail this shop runs — a WhatsApp
 * message, a bank transfer, cash at the door — where there is no card to
 * charge and no invoice anybody else will raise.
 *
 * The second is not a lesser version of the first, it is the version most of
 * this product's sellers can actually use. A gym in a cash economy, a class
 * that collects by bank transfer, a club that settles over WhatsApp: none of
 * them can take a recurring card payment, and all of them have members.
 *
 * What changes between the two is only *who runs the cycle*. Access, the
 * grace period, the members list and cancellation all read the same two
 * columns — `status` and `currentPeriodEnd` — and neither knows which mode
 * wrote them. That is why `membershipAccess` needed no change at all.
 */
export function isManual(subscription: { billingMode: string }): boolean {
  return subscription.billingMode === "manual";
}

/* --------------------------------------------------------------------------
   What Sailo keeps
-------------------------------------------------------------------------- */

/**
 * Stripe's `application_fee_percent`, as the basis points everything else
 * speaks.
 *
 * Every fee in this codebase is basis points -- `Plan.feeBp`, `platformFeeBp`
 * -- and Stripe's field is a percentage, so exactly one of the two has to be
 * converted and it is not the one twenty other files read. Integers also
 * compare exactly, which is the whole reason the fee is worth storing: the
 * question asked of it is "has this drifted from the plan", and a float
 * answers that with an epsilon nobody chose.
 *
 * Absent and zero fold together on purpose. `createSubscriptionSession` omits
 * the parameter entirely when the fee would be zero, while updating a
 * subscription to zero stores `0.0` -- measured against the live API, not
 * assumed. Both mean "we take nothing", and a reconciler that saw two
 * different values for one fact would rewrite those rows for ever.
 */
export function feeBpFromPercent(percent: number | null | undefined): number {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return 0;
  return Math.round(percent * 100);
}

/**
 * The same number on the way back out to Stripe.
 *
 * Stripe accepts at most two decimal places, which basis points cannot exceed
 * -- an integer over 100 has two at most. Carrying the fee as bp is what makes
 * that guarantee structural instead of a range check somebody has to remember.
 */
export function feePercentFromBp(bp: number): number {
  return bp / 100;
}

/**
 * The statuses Stripe will never raise another invoice for, and the test the
 * fee sweep asks in SQL and TypeScript alike.
 *
 * From `@sailo/core/subscription-status`, which owns the whole vocabulary —
 * this file carried its own hand-written copy for a while after that module
 * claimed to have consolidated them, which is exactly the drift the core
 * module's own header warns about.
 *
 * `canStillInvoice` is deliberately neither `OPEN_STATUSES` below nor the
 * webhook's `TERMINAL`. Those answer "does the door open" and "may this row
 * be resurrected", and both are wrong here in opposite directions: a
 * `past_due` member is not being let in while Stripe is still retrying their
 * card, and an `unpaid` one is no longer being retried while the
 * subscription still exists and can be revived. Access and billing are
 * different questions about the same column.
 */
export { SETTLED_STATUSES, canStillInvoice } from "@sailo/core/subscription-status";

/**
 * How long before a period ends the next order is raised.
 *
 * A member paying by bank transfer needs the request *before* their access
 * runs out, not on the morning it does — a transfer takes a day or two to
 * arrive and the seller has to see it and confirm it. Five days is enough for
 * a slow bank and short enough that nobody is asked to pay for a month they
 * are still two-thirds of the way through.
 */
export const RENEWAL_LEAD_DAYS = 5;

/*
 * There is deliberately no grace constant for a manual membership.
 *
 * A card subscription is treated leniently while it is `past_due` because
 * Stripe is still *trying* — the money may yet arrive with nobody doing
 * anything. Nothing is trying on a bank transfer: if it has not arrived, it
 * has not arrived, and extending access would be the seller giving away a
 * month they never agreed to. `membershipAccess` already closes the door when
 * the paid period ends, so the correct amount of extra grace is none, and a
 * `= 0` constant would only invite somebody to tune it.
 */

/**
 * How long an unpaid renewal waits before the membership is called over.
 *
 * Not the same question as access, which stopped at the period end. This is
 * when to stop *asking* — to stop raising orders the member is not paying and
 * let the seller's list tell the truth about who is still a member.
 */
export const MANUAL_LAPSE_DAYS = 21;

/* --------------------------------------------------------------------------
   Interval arithmetic
-------------------------------------------------------------------------- */

/**
 * One interval on from a date, in calendar terms rather than in days.
 *
 * "A month" is not 30 days, and using 30 would walk a member's renewal date
 * backwards through the year until a January signup was being billed in
 * mid-December. `setMonth` does the calendar arithmetic, and the clamp is the
 * part that has to be written down: 31 January plus one month is 31 February,
 * which JavaScript silently rolls into 2 or 3 March. A membership taken out
 * on the 31st should renew on the last day of the next month, not skip into
 * the one after.
 */
export function addInterval(
  from: Date,
  interval: BillingInterval,
  /** How many of them — the `3` in "every 3 months". */
  count = 1,
): Date {
  const steps = normalizeIntervalCount(count, interval);
  const next = new Date(from.getTime());

  /*
   * Days and weeks are exact spans and are added as such — no calendar
   * clamping applies, because there is no such thing as the 31st of a week.
   * `setDate` past the end of a month rolls forward correctly on its own,
   * which is the behaviour wanted here and the bug being guarded against
   * below.
   */
  if (interval === "day") {
    next.setDate(next.getDate() + steps);
    return next;
  }
  if (interval === "week") {
    next.setDate(next.getDate() + steps * 7);
    return next;
  }

  if (interval === "year") {
    next.setFullYear(next.getFullYear() + steps);
    // 29 February plus a year is 28 February, not 1 March.
    if (next.getDate() !== from.getDate()) next.setDate(0);
    return next;
  }

  const day = from.getDate();
  next.setMonth(next.getMonth() + steps);
  // Rolled over into the following month because the target one is shorter:
  // step back to its last day.
  if (next.getDate() !== day) next.setDate(0);
  return next;
}

/**
 * Where the next period ends, given where this one did.
 *
 * Measured from the period end rather than from today, so a member who pays
 * three days late keeps their original renewal date instead of drifting it
 * later every single period. The exception is a membership that lapsed long
 * ago: counting forward from a period that ended in March would hand somebody
 * paying in September a period that has already expired, so a period end in
 * the past starts again from now.
 */
export function nextPeriodEnd(
  current: Date | null,
  interval: BillingInterval,
  now = new Date(),
  count = 1,
): Date {
  const from = current && current.getTime() > now.getTime() ? current : now;
  return addInterval(from, interval, count);
}

/* --------------------------------------------------------------------------
   The product
-------------------------------------------------------------------------- */

/** The slice of a product this module needs. Widened so a quote row fits too. */
export type MembershipProduct = Pick<
  Product,
  "kind" | "priceCents" | "billingInterval"
> & {
  /** Absent on the trimmed rows a quote carries; one is the assumed cycle. */
  billingIntervalCount?: number | null;
};

export function isMembership(product: Pick<Product, "kind">): boolean {
  return product.kind === "membership";
}

/**
 * Whether this membership can actually be sold.
 *
 * A membership at zero is the case worth naming: Stripe will not create a
 * recurring price for nothing, and a "free membership" is a thing a seller
 * reaches for when they mean a free product. Refusing here — rather than
 * letting the checkout fail at Stripe with a message nobody can act on — is
 * what turns it into a sentence the seller can fix.
 */
export function membershipSellable(product: MembershipProduct): boolean {
  return (
    isMembership(product) &&
    product.priceCents > 0 &&
    isBillingInterval(product.billingInterval)
  );
}

/* --------------------------------------------------------------------------
   Access
-------------------------------------------------------------------------- */

/**
 * Statuses that mean the member is paid up, or fairly treated as such.
 *
 * `past_due` is in the list and that is the deliberate part. Stripe retries a
 * failed card for days before giving up, and a gym that locks the door on the
 * morning a card expires — while its own dunning email is still in flight —
 * has punished a member for a bank's fraud check. The period they already
 * paid for is the boundary that actually matters, and `currentPeriodEnd`
 * enforces it below; status alone never does.
 */
const OPEN_STATUSES = new Set<string>(ACTIVE_SUBSCRIPTION_STATUSES);

/**
 * Frozen — spec 49.
 *
 * **A status rather than a second access predicate, and that is the whole
 * design of pause.** `membershipAccess` reads `status` and `currentPeriodEnd`
 * and has never known who wrote them; expressing a freeze as one more status
 * outside `OPEN_STATUSES` means the door gate, the members list, the download
 * route, the door pass and the renewal cron all close for a paused member with
 * **no code change at all** — the same property that made adding the manual
 * rail cost nothing.
 *
 * The alternative — a `pausedUntil` clause inside `membershipAccess` — would
 * have been a second thing that decides access, and the five readers above
 * would each have had to learn about it or quietly keep letting people in.
 *
 * `pausedAt` / `pausedUntil` are still columns, because they answer *when* and
 * *how long*, which a status cannot. They are read by the resume sweep and by
 * the seller's list; they are not read by anything that decides entitlement.
 */
export const PAUSED_STATUS: SubscriptionStatus = "paused";

export type MembershipAccess = {
  /** Whether the door opens right now. */
  open: boolean;
  /** True while they are inside a period they paid for but have cancelled. */
  endingSoon: boolean;
  /** When access runs out, if it is going to. */
  until: Date | null;
};

/**
 * Whether a subscription lets somebody in at this instant.
 *
 * Two conditions, and the second is the one that is easy to leave out: the
 * status has to be an open one *and* the period they paid for must not have
 * run out. Without the second, a `past_due` member whose card never recovered
 * keeps their access indefinitely, because Stripe can take a week to move
 * them to `canceled` and something has to hold the line in the meantime.
 *
 * A missing `currentPeriodEnd` is treated as open when the status is open —
 * that is the gap between `checkout.session.completed` and the first
 * `customer.subscription.updated`, which is seconds wide and during which the
 * member has definitely just paid.
 */
export function membershipAccess(
  subscription:
    | (Pick<Subscription, "status" | "currentPeriodEnd" | "cancelAtPeriodEnd"> &
        /*
         * Optional, and deliberately so. Every caller selecting the three
         * columns this function has always read keeps compiling and keeps
         * getting the same answer — the two below are absent, `accessAfterTerm`
         * reads as false, and the new branch cannot fire. A required pair would
         * have made every existing `columns:` selection a compile error and
         * invited somebody to widen `Subscription` instead.
         */
        Partial<Pick<Subscription, "accessAfterTerm" | "endedReason">>)
    | null,
  now = new Date(),
): MembershipAccess {
  if (!subscription) return { open: false, endingSoon: false, until: null };

  const until = subscription.currentPeriodEnd;
  const statusOpen = OPEN_STATUSES.has(subscription.status);
  const withinPeriod = !until || until.getTime() > now.getTime();

  /*
   * THE ONE NEW BRANCH — spec 49, and there is not allowed to be a second.
   *
   * A fixed-term membership that keeps access is how a seller sells a course
   * in three payments without Sailo building an instalments engine, which
   * `GAP-2026-08-easytools.md` §4.7 refuses on money-path grounds. The
   * subscription is genuinely over — `status` is `canceled`, billing has
   * stopped, the members list says so — and the door stays open because the
   * seller sold it that way.
   *
   * Both halves are required. `endedReason === "term_complete"` is what
   * separates "they finished paying" from "they cancelled in month two", and
   * without it a member who quit a 12-cycle course after one payment would
   * keep the whole course. `accessAfterTerm` is the seller's own answer,
   * snapshotted at signup so changing the product later does not retroactively
   * withdraw access somebody already earned.
   *
   * Pause is *not* here, and that is not an omission. A frozen membership sits
   * at `status = "paused"`, which is simply not in `OPEN_STATUSES` — so it
   * closes through the predicate that already existed rather than through a
   * second one. See `PAUSED_STATUS`.
   */
  if (
    subscription.endedReason === "term_complete" &&
    subscription.accessAfterTerm === true
  ) {
    return { open: true, endingSoon: false, until: null };
  }

  return {
    open: statusOpen && withinPeriod,
    endingSoon: statusOpen && withinPeriod && subscription.cancelAtPeriodEnd,
    until,
  };
}

/** The most permissive answer across everything a person subscribes to. */
export function anyAccess(
  subscriptions: Pick<
    Subscription,
    "status" | "currentPeriodEnd" | "cancelAtPeriodEnd"
  >[],
  now = new Date(),
): boolean {
  return subscriptions.some((s) => membershipAccess(s, now).open);
}

/* --------------------------------------------------------------------------
   Pricing
-------------------------------------------------------------------------- */

/**
 * Whether the cached Stripe Price still matches what the product costs.
 *
 * A Stripe Price is immutable — you cannot edit the amount on one — so the
 * only correct response to a seller changing the price is to mint a new Price
 * and leave existing members on the old one. This is the check that notices,
 * and getting it wrong in the lenient direction means charging next month's
 * new subscriber last month's price forever.
 *
 * The interval is compared as well as the amount, and it has to be: a
 * membership switched from monthly to yearly at the same number changes no
 * price, so an amount-only check sees nothing and keeps billing every month
 * for something the product now sells annually.
 */
export function priceIsStale(product: {
  priceCents: number;
  billingInterval: string | null;
  billingIntervalCount?: number | null;
  stripePriceId: string | null;
  stripePriceCents: number | null;
  stripePriceInterval: string | null;
  stripePriceIntervalCount?: number | null;
}): boolean {
  if (!product.stripePriceId) return true;
  if (product.stripePriceCents !== product.priceCents) return true;
  if (product.stripePriceInterval !== intervalOf(product)) return true;
  /*
   * And the count, for the same reason the interval is here and the amount
   * alone was not enough: a membership moved from "every month" to "every 3
   * months" changes neither the amount nor the interval, so the two checks
   * above see an unchanged product and every new member goes on being billed
   * monthly against a Price the seller no longer sells.
   *
   * `?? 1` on the stored side rather than a null check, because a Price minted
   * before this column existed was minted at a count of one — which is what
   * Stripe defaults to, so the fallback is a fact rather than a guess.
   */
  return (product.stripePriceIntervalCount ?? 1) !== intervalCountOf(product);
}

/**
 * What one interval costs, said in words the buyer reads on the button.
 *
 * The labels themselves are translated by the caller — this only decides
 * which of them applies, so that no screen has to re-derive it from a raw
 * column and get `year` wrong.
 */
export function intervalOf(product: {
  billingInterval: string | null;
}): BillingInterval {
  return isBillingInterval(product.billingInterval) ? product.billingInterval : "month";
}

/**
 * And how many of them per charge.
 *
 * Clamped against the interval this product actually sells on, so "every 400
 * days" cannot reach Stripe, and folded to one whenever the column is absent —
 * which it is on every trimmed row a quote or a card carries.
 */
export function intervalCountOf(product: {
  billingInterval: string | null;
  billingIntervalCount?: number | null;
}): number {
  return normalizeIntervalCount(
    product.billingIntervalCount ?? 1,
    intervalOf(product),
  );
}
