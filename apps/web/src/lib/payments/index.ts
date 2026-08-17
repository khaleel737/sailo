/**
 * Payments, as this app's twenty-three callers still spell it.
 *
 * Two packages behind one name, because a screen that lets a seller pick a rail
 * and set an order's payment status reaches for both in the same breath:
 *
 *   `@sailo/payments/offline`     what rails exist, and what the buyer sees
 *   `@sailo/core/payment-status`  what state an order's money is in
 *
 * They are in different packages on purpose. The status describes an *order*
 * and the phone renders it, so it sits in `@sailo/core` with no vendor behind
 * it; `@sailo/payments` would drag Stripe into the native bundle.
 *
 * This is the last aggregating barrel left in `src/lib`. The single-target
 * shims — `@/lib/plans`, `@/lib/legal`, `@/lib/countries` and eleven more —
 * were deleted and their callers now name the package they mean.
 */

export * from "@sailo/core/payment-status";
export * from "@sailo/payments/offline";
