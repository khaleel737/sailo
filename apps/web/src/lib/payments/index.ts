/**
 * Payments, in three parts: the statuses an order's money can be in, the rails
 * it can arrive through, and what happens to the buyer once they pick one.
 *
 * Re-exported from here because twenty-three files import "@/lib/payments"
 * and the split is not their concern.
 */

export * from "./status";
export * from "./rails";
export * from "./handoff";
