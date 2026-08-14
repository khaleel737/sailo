/**
 * The commerce rules that outlived apps/web.
 *
 * Stock movements, admissions, booking claims and coupon redemptions were all
 * written as `apps/web/src/lib/*` because the web admin was the only thing that
 * changed an order. The mobile app changes orders too now, and these are the
 * rules that have to hold whichever surface the seller used — so they moved
 * here rather than being copied there.
 *
 * Everything in this package touches the database and imports `server-only`.
 * It is not importable from a React Native bundle and is not meant to be: the
 * mobile app reaches it through `@sailo/api`, over the wire.
 */

export * from "./orders";
export * from "./products";
export * from "./pagination";
export * from "./inventory";
export * from "./tickets";
export * from "./booking-claim";
export * from "./coupon-redemption";
export * from "./door";
export * from "./door-list";
export * from "./door-pass";
export * from "./idempotency";
export * from "./webhooks";
