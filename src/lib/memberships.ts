import type { Product, Subscription } from "@/db/schema";

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

export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export function isBillingInterval(value: unknown): value is BillingInterval {
  return typeof value === "string" && (BILLING_INTERVALS as readonly string[]).includes(value);
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
export function addInterval(from: Date, interval: BillingInterval): Date {
  const next = new Date(from.getTime());

  if (interval === "year") {
    next.setFullYear(next.getFullYear() + 1);
    // 29 February plus a year is 28 February, not 1 March.
    if (next.getDate() !== from.getDate()) next.setDate(0);
    return next;
  }

  const day = from.getDate();
  next.setMonth(next.getMonth() + 1);
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
): Date {
  const from = current && current.getTime() > now.getTime() ? current : now;
  return addInterval(from, interval);
}

/* --------------------------------------------------------------------------
   The product
-------------------------------------------------------------------------- */

/** The slice of a product this module needs. Widened so a quote row fits too. */
export type MembershipProduct = Pick<
  Product,
  "kind" | "priceCents" | "billingInterval"
>;

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
const OPEN_STATUSES = new Set(["trialing", "active", "past_due"]);

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
  subscription: Pick<
    Subscription,
    "status" | "currentPeriodEnd" | "cancelAtPeriodEnd"
  > | null,
  now = new Date(),
): MembershipAccess {
  if (!subscription) return { open: false, endingSoon: false, until: null };

  const until = subscription.currentPeriodEnd;
  const statusOpen = OPEN_STATUSES.has(subscription.status);
  const withinPeriod = !until || until.getTime() > now.getTime();

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
  stripePriceId: string | null;
  stripePriceCents: number | null;
  stripePriceInterval: string | null;
}): boolean {
  if (!product.stripePriceId) return true;
  if (product.stripePriceCents !== product.priceCents) return true;
  return product.stripePriceInterval !== intervalOf(product);
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
