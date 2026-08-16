/**
 * The partner programme, as arithmetic and strings.
 *
 * Everything here is pure: no database, no Stripe, no request. The terms
 * themselves — rate, minimum, hold, cookie window — are *settings* now rather
 * than constants, because they are commercial terms someone will want to move
 * for a campaign without a deploy; this file holds the defaults they fall back
 * to and the arithmetic that applies them. Keeping the maths in one testable
 * file is what stops the copy on the landing page and the number in the ledger
 * drifting apart.
 *
 * The reads and writes that use all this are in `./store.ts`, `./payouts.ts`
 * and `./settings.ts`.
 */

/* -------------------------------------------------------------------------- */
/*  The terms                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What a partner earns, in basis points — 3000 = 30%.
 *
 * Of the *invoice*, not of the plan price: a seller who paid a prorated
 * upgrade or used a discount generated less revenue, and 30% of the list price
 * would pay commission on money we never received.
 *
 * 30% rather than the 20% Stan pays, and the difference is not generosity.
 * Stan takes 20% of a $29–$99 plan, so their partners see $5.80–$19.80 a
 * month. Sailo's plans are $19 and $49; matching their *percentage* would
 * pay well under their *money*, and a partner choosing where to point an
 * audience compares dollars. 30% puts a Business referral at $14.70/month,
 * near the top of Stan's range rather than at its floor, and beats Kajabi's
 * current 10–20% ladder,
 * ConvertKit's 30%-for-24-months and Podia's 25%-for-12-months on duration —
 * ours has no cap and no expiry.
 */
export const DEFAULT_COMMISSION_BP = 3000;

/**
 * The smallest balance we send. Below it the transfer fee is a meaningful
 * fraction of the payment, so it rolls over.
 *
 * Stated on the partner's dashboard, in every language. A threshold the
 * partner discovers by not being paid is the thing this default exists to
 * prevent.
 */
export const DEFAULT_PAYOUT_MINIMUM_CENTS = 2500;

/** How long a click on a partner link stays attributable, in days. */
export const DEFAULT_COOKIE_DAYS = 90;

/**
 * How long an earning sits before it can be sent, in days.
 *
 * The referred creator can be refunded, and a refund reverses the commission.
 * Paying on day one means a day-nine refund claws back money that is already
 * in someone else's bank account and can only be recovered from their *next*
 * earning — which a partner who has stopped promoting will never have. Thirty
 * days covers the ordinary refund window with room to spare.
 */
export const DEFAULT_HOLD_DAYS = 30;

/** The cookie `/r/<code>` sets and account creation reads exactly once. */
export const REFERRAL_COOKIE = "sailo_creator_ref";

export const REFERRAL_CODE_LENGTH = 8;

/* -------------------------------------------------------------------------- */
/*  Status                                                                     */
/* -------------------------------------------------------------------------- */

export const PARTNER_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "suspended",
] as const;

export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export function isPartnerStatus(value: string): value is PartnerStatus {
  return (PARTNER_STATUSES as readonly string[]).includes(value);
}

/**
 * Whether this partner's links may still attribute and earn.
 *
 * One function rather than `status === "approved"` written in five places,
 * because those five places must agree: attribution, the payout run, the
 * portal's own copy, HQ's roster and the `/r/<code>` lookup. A suspended
 * partner whose old links keep earning is the case this closes.
 */
export function canEarn(status: string): boolean {
  return status === "approved";
}

/* -------------------------------------------------------------------------- */
/*  The rate                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The rate that applies to one partner right now.
 *
 * A per-partner override is a negotiated deal and wins outright; everyone else
 * gets the programme default. Null is the ordinary case, so the override is
 * checked for existence rather than truth — a deliberate 0% is a real
 * arrangement (a partner kept on the books but earning nothing) and must not
 * fall through to 30%.
 */
export function resolveCommissionBp(
  partnerOverrideBp: number | null | undefined,
  programDefaultBp: number,
): number {
  return partnerOverrideBp ?? programDefaultBp;
}

/**
 * The partner's cut of one invoice, in minor units.
 *
 * Floored rather than rounded, so the sum of what we pay out can never exceed
 * the share of what we took in. A half-cent in our favour on each invoice is
 * the right direction for the rounding error to lean when the alternative is
 * paying commission on money that does not exist.
 */
export function commissionCents(
  invoiceAmountCents: number,
  commissionBp: number,
): number {
  if (!Number.isFinite(invoiceAmountCents) || invoiceAmountCents <= 0) return 0;
  if (!Number.isFinite(commissionBp) || commissionBp <= 0) return 0;
  return Math.floor((invoiceAmountCents * commissionBp) / 10_000);
}

/** "30%", for copy that must not write the number itself. */
export function shareLabel(commissionBp: number): string {
  return `${Number((commissionBp / 100).toFixed(2))}%`;
}

/**
 * When an earning written now becomes eligible to send.
 *
 * Computed at write time and stored, not derived at read time: the hold is a
 * setting, and a row must keep the terms it was written under. Shortening the
 * hold tomorrow should not retroactively release money that was promised on a
 * thirty-day clock, and lengthening it should not freeze balances partners
 * have already been shown as available.
 */
export function maturityDate(from: Date, holdDays: number): Date {
  const at = new Date(from);
  at.setUTCDate(at.getUTCDate() + Math.max(0, holdDays));
  return at;
}

/* -------------------------------------------------------------------------- */
/*  Codes                                                                      */
/* -------------------------------------------------------------------------- */

/*
 * No 0/O, no 1/I/L. The code is read off a phone screen, typed into a DM and
 * said out loud on a podcast; the pairs that get transcribed wrong are worth
 * more than the entropy they cost. 32 symbols over 8 characters is 2^40 — far
 * beyond guessing a code that only ever grants attribution anyway.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function newReferralCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(REFERRAL_CODE_LENGTH));
  /*
   * Modulo bias, deliberately accepted and named: 256 % 31 is not zero, so
   * the first few symbols are marginally likelier. This code is an
   * attribution tag, not a secret — the uniqueness index is what makes it
   * work, and a rejection-sampling loop here would buy nothing.
   */
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/**
 * A code as typed by a human, in the one form the database stores — or null
 * for anything that could not be a code at all.
 *
 * The null matters more than the uppercasing: `/r/<code>` is a public,
 * unauthenticated path and this is the only thing between it and a query.
 * Length and alphabet are checked rather than escaped, so nothing that
 * reaches the lookup can be anything but eight symbols from the set above.
 *
 * No confusable-folding, on purpose. `0`, `1`, `O`, `I` and `L` are all
 * absent from the alphabet, so neither member of either pair can appear in a
 * real code and there is nothing to fold *to*. Ambiguity was removed by
 * choosing the alphabet; a rewrite step here would only invent codes.
 */
export function normalizeReferralCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  if (code.length !== REFERRAL_CODE_LENGTH) return null;
  for (const char of code) {
    if (!ALPHABET.includes(char)) return null;
  }
  return code;
}

/** The link a partner shares. */
export function referralUrl(code: string, base = process.env.NEXT_PUBLIC_APP_URL) {
  return `${base ?? ""}/r/${code}`;
}

/* -------------------------------------------------------------------------- */
/*  Shaping a balance out of ledger rows                                       */
/* -------------------------------------------------------------------------- */

export type LedgerRow = {
  amountCents: number;
  currency: string;
  matureAt: Date;
  paidOutAt: Date | null;
};

export type PartnerBalance = {
  /** Everything ever earned, reversals included. */
  lifetimeCents: number;
  /** Earned and not yet sent — held and available together. */
  unpaidCents: number;
  /** Unpaid and still inside the hold period. */
  heldCents: number;
  /** Unpaid, out of hold, and therefore sendable. */
  availableCents: number;
  /** Already sent. */
  paidCents: number;
  /** True once `availableCents` clears the threshold. */
  payable: boolean;
};

/**
 * Whether a balance has cleared the threshold and can be sent.
 *
 * One function rather than the comparison written twice, because it *is*
 * written in two places that have to agree: the partner's dashboard promises
 * "we send it once it passes {minimum}", and the payout run decides whether
 * anything is actually transferred. A drift between those two is a partner
 * told they are owed money by a system that will not send it.
 *
 * The `> 0` is not redundant with the threshold: a zero minimum is a legal
 * setting, and "pay everyone their zero balance" would be a monthly run of
 * failing transfers.
 */
export function isPayableBalance(
  availableCents: number,
  minimumCents: number,
): boolean {
  return availableCents > 0 && availableCents >= minimumCents;
}

/**
 * Sums a ledger.
 *
 * Reversals are negative rows, so this is a plain sum in every column — a
 * refund reduces the balance without anything being rewritten, and if it lands
 * after we have already paid out, the balance simply goes negative and the
 * next invoice works it off. That is the honest answer; clamping it to zero
 * here would quietly forgive money.
 *
 * The held/available split is what the hold period buys, and it is computed
 * against a caller-supplied `now` rather than a read of the clock so the
 * function stays pure and the boundary stays testable.
 *
 * Currency is taken from the rows rather than assumed. Sailo bills sellers in
 * one currency today, but "today" is not a thing to encode in a ledger.
 */
export function partnerBalance(
  rows: LedgerRow[],
  minimumCents: number,
  now: Date = new Date(),
): PartnerBalance {
  let lifetimeCents = 0;
  let paidCents = 0;
  let heldCents = 0;
  let availableCents = 0;

  for (const row of rows) {
    lifetimeCents += row.amountCents;
    if (row.paidOutAt) {
      paidCents += row.amountCents;
    } else if (row.matureAt > now) {
      heldCents += row.amountCents;
    } else {
      availableCents += row.amountCents;
    }
  }

  return {
    lifetimeCents,
    unpaidCents: heldCents + availableCents,
    heldCents,
    availableCents,
    paidCents,
    payable: isPayableBalance(availableCents, minimumCents),
  };
}

/** The currency a ledger is denominated in, or null when it holds nothing. */
export function ledgerCurrency(rows: { currency: string }[]): string | null {
  return rows[0]?.currency ?? null;
}
