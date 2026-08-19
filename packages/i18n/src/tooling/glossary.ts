/**
 * The words a machine may not translate on its own.
 *
 * Decision A (`RELEASE-PLAN-2026-08.md` §0.5) chose machine translation on merge
 * *with a reviewed glossary that is never machine-touched*, and this is that
 * glossary. The reason for it is narrow and worth stating exactly: a mistranslated
 * label on a marketing section is embarrassing, and a mistranslated label on a
 * price, a tax line, a refund or a cancellation is a claim about somebody's money
 * that they will act on.
 *
 * Two mechanisms, because there are two different failure modes.
 *
 * **`PROTECTED_SECTIONS`** are whole sections a filler refuses to write. Every
 * string in them reaches a buyer or a seller at the moment money moves, and a
 * plausible-but-wrong translation there is not caught by reading the screen —
 * it is caught by a complaint. They are listed for human translation instead.
 *
 * **`PROTECTED_TERMS`** are words that keep their meaning wherever they appear.
 * A filler passes these to the model as a binding glossary rather than refusing
 * the string, because a sentence containing "refund" is usually ordinary copy
 * that simply has to get that one word right.
 *
 * Adding to either list is cheap and removing from it is not. When unsure,
 * protect it.
 */

/**
 * Sections no machine writes. Named by their key in `en.ts`.
 *
 * Membership in this list is decided by one question: *if this string were
 * subtly wrong, would somebody make a financial decision on it before anybody
 * noticed?* Section names are checked against the English dictionary at load, so
 * a rename cannot quietly empty the list — see `assertSectionsExist`.
 */
export const PROTECTED_SECTIONS: Readonly<Record<string, readonly string[]>> = {
  /*
   * The storefront's money surfaces. `checkout` and `cart` carry the totals a
   * buyer agrees to, `rails` names the ways they can pay, `invoice` is the
   * numbered document a tax authority expects to be right, `billing` and
   * `membership` are recurring charges somebody has to be able to stop, and
   * `download` is what a digital sale actually delivers.
   */
  storefront: [
    "checkout",
    "cart",
    "rails",
    "invoice",
    "billing",
    "membership",
    "download",
  ],
  /*
   * The seller's. `billing` is what they subscribe on, `payments` and
   * `paymentStatus` are money arriving from buyers, `payouts` and `payoutStatus`
   * are money reaching their bank, `coupons` is a discount off a real total, and
   * `orders`/`orderStatus` is what a chargeback is argued from.
   */
  admin: [
    "billing",
    "payments",
    "paymentStatus",
    "payouts",
    "payoutStatus",
    "coupons",
    "orders",
    "orderStatus",
  ],
};

/**
 * Words whose meaning must survive translation, with the reason each is here.
 *
 * Handed to the model as a glossary it must honour, not as a list of things to
 * leave in English — a German seller reading "Erstattung" is served; one reading
 * "refund" is not. What is being pinned is the *concept*, so that "refund" never
 * comes back as the looser "return" and "subscription" never as "membership",
 * which is a different product in this codebase and has its own page.
 */
export const PROTECTED_TERMS: Readonly<Record<string, string>> = {
  price: "the amount charged, before tax and delivery",
  total: "the final amount the buyer pays, tax and delivery included",
  subtotal: "the amount before tax and delivery",
  tax: "government tax on the sale — never a fee, never a charge",
  VAT: "value-added tax, as a named tax; keep the local equivalent's own name",
  refund: "money returned to the buyer — never a product return or exchange",
  chargeback: "a bank reversing a payment at the cardholder's request",
  dispute: "the chargeback case itself, not a disagreement generally",
  subscription: "a recurring charge for a Sailo plan",
  membership: "a recurring product a seller sells to a buyer — not a Sailo plan",
  cancel: "end a recurring charge — never merely close or dismiss a screen",
  payout: "money leaving Sailo for the seller's bank",
  invoice: "the numbered document issued for a sale",
  deposit: "a part payment taken up front",
  fee: "a charge Sailo or Stripe takes — never a tax",
};

/** Whether a filler may write this key at all. */
export function isProtected(
  surface: keyof typeof PROTECTED_SECTIONS,
  keyPath: string,
): boolean {
  const section = keyPath.split(".")[0] ?? "";
  return (PROTECTED_SECTIONS[surface] ?? []).includes(section);
}

/**
 * The glossary entries a given English string actually needs.
 *
 * Sending all fifteen with every string wastes tokens and, worse, invites the
 * model to work a term into a sentence that never had it. Whole-word matching,
 * case-insensitive, so "Repriced" does not drag in "price".
 */
export function glossaryFor(english: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [term, meaning] of Object.entries(PROTECTED_TERMS)) {
    const pattern = new RegExp(`\\b${term}\\b`, "i");
    if (pattern.test(english)) out[term] = meaning;
  }
  return out;
}

/**
 * Refuse to run against a dictionary where a protected section has been renamed.
 *
 * The failure this prevents is silent and total: rename `checkout` to `basket`,
 * and the protection quietly covers nothing while every check still passes. A
 * glossary that can be disabled by a rename is not a glossary.
 */
export function assertSectionsExist(
  surface: keyof typeof PROTECTED_SECTIONS,
  sections: readonly string[],
): void {
  const known = new Set(sections);
  const missing = (PROTECTED_SECTIONS[surface] ?? []).filter(
    (name) => !known.has(name),
  );
  if (missing.length > 0) {
    throw new Error(
      `i18n glossary: ${surface} sections ${missing.join(", ")} are protected ` +
        `but do not exist. Either they were renamed — update PROTECTED_SECTIONS ` +
        `to the new names — or they were removed, in which case delete the ` +
        `entry. Leaving it is how a money surface stops being protected without ` +
        `anybody deciding that it should.`,
    );
  }
}
