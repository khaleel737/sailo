/**
 * What happens once an order settles, beyond the order itself.
 *
 * Three separate audiences, three modules, one trigger. The order write lives in
 * `@sailo/commerce/orders` and knows nothing about any of them.
 */
export * from "./announce-paid";
export * from "./announce-subscription";
export * from "./notify-seller";
export * from "./confirm-buyer";
export * from "./referral";
