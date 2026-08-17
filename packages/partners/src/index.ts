/**
 * The people who sell a shop's goods without owning it.
 *
 * WHY IT IS ONE PACKAGE
 *
 * A partner programme is four questions that only make sense together: who may
 * join (`eligibility`), what they joined (`program`, `settings`), what they have
 * earned (`payouts`, `store`), and how they see it without an account
 * (`portal`). Those were spread across `apps/web/src/lib/partners` and one file
 * in `lib/`, which meant the phone could show a seller their affiliates but not
 * their partner ledger.
 *
 *   ./eligibility   whether a shop or a person may take part
 *   ./program       the programme itself, and joining one
 *   ./applications  requests waiting on a seller's answer
 *   ./settings      commission, cookie window, payout threshold
 *   ./store         the ledger: what was earned, on which order
 *   ./payouts       turning a balance into a Stripe transfer
 *   ./portal        the token that lets a partner see their own numbers
 *
 * `./payouts` is the one to read first if you are changing anything here. It
 * moves money to somebody who is not the shop owner, on a schedule, and its
 * threshold and hold rules are the difference between paying a partner twice and
 * not paying them at all.
 */
export * from "./eligibility";
export * from "./program";
export * from "./applications";
export * from "./settings";
export * from "./store";
export * from "./payouts";
export * from "./portal";
