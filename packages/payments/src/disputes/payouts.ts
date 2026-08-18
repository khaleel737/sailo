import "server-only";
import type Stripe from "stripe";
import { stripe } from "../stripe/client";

/**
 * Holding and releasing a connected account's payouts.
 *
 * The reversible move, and the reason the escalation ladder starts here rather
 * than at the storefront. Closing a shop stops future orders, which is not where
 * the exposure is — the exposure is the balance about to be paid out. Sailo is
 * the losses collector for these accounts, so money that leaves a seller's
 * balance before their disputes resolve is money Sailo covers first and recovers
 * second (`payments-compliance.md` §3.2).
 *
 * Verified against the API in test mode on 17 August 2026, because the obvious
 * implementation is wrong twice over:
 *
 * - **Not `payouts_enabled: false`.** That field is read-only — it reports
 *   whether Stripe has *granted* the capability, and a platform cannot set it.
 * - **Not `capability` revocation.** Removing `transfers` would stop the account
 *   receiving charges too, which closes the shop by another route.
 *
 * The correct lever is the payout *schedule*: `interval: "manual"` leaves
 * `payouts_enabled: true` — the capability intact, the balance accruing, the shop
 * trading — and simply schedules nothing. One update back to the seller's
 * previous interval reverses it, and a seller on a weekly schedule may never
 * notice a hold that lasted two days.
 */

/** Stripe's own payout intervals. `manual` is the hold. */
export type PayoutInterval = "manual" | "daily" | "weekly" | "monthly";

export type PayoutState = {
  /** Whether Stripe has granted the capability at all. Read-only. */
  enabled: boolean;
  interval: PayoutInterval | null;
  /** True when nothing is scheduled — i.e. the hold is in force. */
  held: boolean;
};

export function payoutStateOf(account: Stripe.Account): PayoutState {
  const schedule = account.settings?.payouts?.schedule;
  const interval = (schedule?.interval as PayoutInterval | undefined) ?? null;
  return {
    enabled: Boolean(account.payouts_enabled),
    interval,
    held: interval === "manual",
  };
}

export async function readPayoutState(accountId: string): Promise<PayoutState | null> {
  try {
    return payoutStateOf(await stripe().accounts.retrieve(accountId));
  } catch {
    return null;
  }
}

export type PayoutHoldResult =
  | { ok: true; previousInterval: PayoutInterval | null; alreadyHeld: boolean }
  | { ok: false; error: string };

/**
 * Stop scheduled payouts, remembering what the seller had.
 *
 * Reads the account before writing, and the read is not defensive politeness: a
 * hold that does not record the previous interval can only be released to a
 * guess, and releasing a weekly-payout seller onto a daily schedule changes
 * their cash flow and their bank reconciliation without anybody deciding to.
 * The interval comes back in the result for the caller to store on the shop.
 *
 * Idempotent. Re-holding an already-held account reports `alreadyHeld` and does
 * not overwrite the remembered interval with `manual`, which would make the hold
 * permanent — the failure mode where a second automatic run erases the only
 * record of what to restore.
 */
export async function holdPayouts(accountId: string): Promise<PayoutHoldResult> {
  try {
    const before = payoutStateOf(await stripe().accounts.retrieve(accountId));
    if (before.held) {
      return { ok: true, previousInterval: null, alreadyHeld: true };
    }

    await stripe().accounts.update(accountId, {
      settings: { payouts: { schedule: { interval: "manual" } } },
    });
    return { ok: true, previousInterval: before.interval, alreadyHeld: false };
  } catch (error) {
    const stripeError = error as Stripe.errors.StripeError;
    return { ok: false, error: stripeError.message ?? "Stripe refused the payout hold." };
  }
}

/**
 * Put the seller back on a schedule.
 *
 * `daily` when nothing was remembered, which is Stripe's own default for a new
 * account and the safe direction to be wrong in: paying a seller sooner than
 * they chose is an inconvenience, and holding their money longer than they chose
 * is the thing this function exists to undo.
 */
export async function releasePayouts(
  accountId: string,
  previousInterval: PayoutInterval | null,
): Promise<{ ok: true; interval: PayoutInterval } | { ok: false; error: string }> {
  const interval: PayoutInterval =
    previousInterval && previousInterval !== "manual" ? previousInterval : "daily";
  try {
    await stripe().accounts.update(accountId, {
      settings: { payouts: { schedule: { interval } } },
    });
    return { ok: true, interval };
  } catch (error) {
    const stripeError = error as Stripe.errors.StripeError;
    return { ok: false, error: stripeError.message ?? "Stripe refused the payout release." };
  }
}

/**
 * What the connected account is holding, which is the other half of the exposure.
 *
 * `available` is what a debit can come out of today; `pending` is money still
 * settling that will join it. Both count towards covering an open dispute — the
 * dispute will not resolve for weeks and the pending balance will have landed by
 * then — which is why they are summed rather than reported separately.
 *
 * A negative available balance is the case that matters most: it means a
 * chargeback has already exceeded what the seller held, and Stripe is carrying
 * the shortfall against Sailo's account with a 180-day clock on it.
 */
export type ConnectedBalance = {
  currency: string;
  availableCents: number;
  pendingCents: number;
  /** Positive when the balance has gone under. */
  negativeCents: number;
};

export async function readBalance(
  accountId: string,
  currency: string,
): Promise<ConnectedBalance | null> {
  try {
    /*
     * The account goes in the *options*, not the params. `balance.retrieve` takes
     * no parameters at all, so `{ stripeAccount }` passed first is silently
     * dropped and the call returns the *platform's* balance — which on a healthy
     * platform is a large positive number, and would make every seller's exposure
     * read as fully covered. The empty object is load-bearing.
     */
    const balance = await stripe().balance.retrieve({}, { stripeAccount: accountId });
    const wanted = currency.toLowerCase();
    const pick = (list: Stripe.Balance.Available[]) =>
      list.find((entry) => entry.currency === wanted)?.amount ?? 0;

    const available = pick(balance.available);
    const pending = pick(balance.pending);

    return {
      currency: currency.toUpperCase(),
      /*
       * Floored at zero, with the negative reported separately. A single
       * `availableCents: -30000` would be summed into an exposure calculation as
       * if it *reduced* the shortfall, because the arithmetic there is
       * `openDisputes - balance` — and subtracting a negative adds. Splitting
       * the two makes that impossible rather than merely unlikely.
       */
      availableCents: Math.max(0, available),
      pendingCents: Math.max(0, pending),
      negativeCents: Math.max(0, -available),
    };
  } catch {
    return null;
  }
}
