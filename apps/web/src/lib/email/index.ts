/**
 * Mail, as this app's callers still spell it.
 *
 * The messages themselves are `@sailo/email`, grouped by who receives them —
 * `/transactional`, `/shop`, `/system`, `/lifecycle`. They had to leave because
 * `packages/api` sends them too: a refund from the phone moves money, and
 * nobody being told is worse than no button.
 *
 * Re-exported from one place here because the split is by *audience*, and a
 * caller that sends a receipt and a seller notice in the same function should
 * not have to know that. `lifecycle-messages` is still local — it reads the
 * marketing site's own hero demo and the lifecycle state machine, neither of
 * which is a thing a phone sends.
 */

export * from "@sailo/email/transactional";
export * from "@sailo/email/shop";
export * from "@sailo/email/system";
export * from "@sailo/email/lifecycle";
