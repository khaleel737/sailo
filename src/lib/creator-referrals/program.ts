/**
 * The refer-a-creator programme, as arithmetic and strings.
 *
 * Everything here is pure: no database, no Stripe, no request. The rate, the
 * threshold and the code alphabet are the terms of the programme, and terms
 * that live in one testable file are terms a card can quote without the copy
 * and the code drifting apart — the same reason `PLATFORM_FEE_LABEL` exists
 * in `plans.ts`.
 *
 * The writes and reads that use all this are in `./store.ts`.
 */

/**
 * What a referrer earns, in basis points — 2000 = 20%.
 *
 * Of the *invoice*, not of the plan price: a seller who paid a prorated
 * upgrade or used a discount generated less revenue, and 20% of the list
 * price would pay commission on money we never received.
 */
export const REFERRAL_SHARE_BP = 2000;

/**
 * The smallest balance we send. Below it the transfer fee is a meaningful
 * fraction of the payment, so it rolls over.
 *
 * Stated on the seller's card, in every language. A threshold the seller
 * discovers by not being paid is the thing this constant exists to prevent —
 * see the "no silent caps" rule the plan gating follows.
 */
export const REFERRAL_PAYOUT_MINIMUM_CENTS = 2500;

/**
 * Whether a balance has cleared the threshold and can be sent.
 *
 * One function rather than the comparison written twice, because it *is*
 * written in two places that have to agree: the seller's card promises "we
 * send it once it passes {minimum}", and /hq decides whether the Mark paid
 * button is live at all. A drift between those two is a seller told they are
 * owed money by a panel that will not let anyone send it.
 */
export function isPayableBalance(unpaidCents: number): boolean {
  return unpaidCents >= REFERRAL_PAYOUT_MINIMUM_CENTS;
}

/*
 * There is no cap and no expiry: 20% of every invoice, for as long as the
 * referred creator keeps paying. Noted here because "recurring, for as long
 * as they stay" is the promise printed on the seller's card in 35 languages —
 * anyone adding a 12-month limit has to change that copy too, or the
 * programme starts lying in every one of them.
 */

/** How long a click on a referral link stays attributable, in days. */
export const REFERRAL_COOKIE_DAYS = 90;

/** The cookie `/r/<code>` sets and account creation reads exactly once. */
export const REFERRAL_COOKIE = "sailo_creator_ref";

export const REFERRAL_CODE_LENGTH = 8;

/*
 * No 0/O, no 1/I/L. The code is read off a phone screen, typed into a DM and
 * said out loud on a podcast; the pairs that get transcribed wrong are worth
 * more than the entropy they cost. 32 symbols over 8 characters is 2^40 —
 * far beyond guessing a code that only ever grants attribution anyway.
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

/** The link a seller shares. */
export function referralUrl(code: string, base = process.env.NEXT_PUBLIC_APP_URL) {
  return `${base ?? ""}/r/${code}`;
}

/**
 * The referrer's cut of one invoice, in minor units.
 *
 * Floored rather than rounded, so the sum of what we pay out can never exceed
 * 20% of what we took in. A half-cent in our favour on each invoice is the
 * right direction for the rounding error to lean when the alternative is
 * paying commission on money that does not exist.
 */
export function referralShareCents(invoiceAmountCents: number): number {
  if (!Number.isFinite(invoiceAmountCents) || invoiceAmountCents <= 0) return 0;
  return Math.floor((invoiceAmountCents * REFERRAL_SHARE_BP) / 10_000);
}

/** "20%", for copy that must not write the number itself. */
export const REFERRAL_SHARE_LABEL = `${Number((REFERRAL_SHARE_BP / 100).toFixed(2))}%`;

/* -------------------------------------------------------------------------- */
/*  Shaping a balance out of ledger rows                                       */
/* -------------------------------------------------------------------------- */

export type LedgerRow = {
  amountCents: number;
  currency: string;
  paidOutAt: Date | null;
};

export type ReferralBalance = {
  /** Everything ever earned, reversals included. */
  lifetimeCents: number;
  /** Earned and not yet sent. */
  unpaidCents: number;
  /** Already sent. */
  paidCents: number;
  /** True once `unpaidCents` clears the threshold. */
  payable: boolean;
};

/**
 * Sums a ledger.
 *
 * Reversals are negative rows, so this is a plain sum in both columns — a
 * refund reduces the unpaid balance without anything being rewritten, and if
 * it lands after we have already paid out, the balance simply goes negative
 * and the next invoice works it off. That is the honest answer; clamping it
 * to zero here would quietly forgive money.
 *
 * Currency is taken from the rows rather than assumed. Sailo bills sellers in
 * one currency today, but "today" is not a thing to encode in a ledger.
 */
export function referralBalance(rows: LedgerRow[]): ReferralBalance {
  let lifetimeCents = 0;
  let unpaidCents = 0;
  let paidCents = 0;

  for (const row of rows) {
    lifetimeCents += row.amountCents;
    if (row.paidOutAt) paidCents += row.amountCents;
    else unpaidCents += row.amountCents;
  }

  return {
    lifetimeCents,
    unpaidCents,
    paidCents,
    payable: isPayableBalance(unpaidCents),
  };
}

/** The currency a ledger is denominated in, or null when it holds nothing. */
export function ledgerCurrency(rows: LedgerRow[]): string | null {
  return rows[0]?.currency ?? null;
}
