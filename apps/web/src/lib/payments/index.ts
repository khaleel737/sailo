/**
 * Payments, as this app's twenty-three callers still spell it.
 *
 * The rails and the buyer handoff moved to `@sailo/payments/offline` — cash on
 * delivery, bank transfer and a WhatsApp handoff are how most shops in Sailo's
 * markets are actually paid, and the phone has to make the same decisions about
 * them as the browser. `isRailUsable` in particular is what tells a seller
 * whether their shop can be paid at all, and a second copy of that would tell
 * one surface yes and the other no.
 *
 * The order's payment *status* stayed in `@sailo/core`, where its own header
 * explains why: it describes an order's state rather than a rail's, and
 * `@sailo/payments` is a server package that would drag Stripe into the phone's
 * bundle behind it.
 */

export * from "./status";
export * from "@sailo/payments/offline";
