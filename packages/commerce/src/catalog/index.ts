/**
 * What is for sale, how much of it is left, and how to read it back.
 *
 * Server-only throughout — every module here opens a connection — so there is
 * one entry rather than the client-safe/`server` pair `orders` and `booking`
 * have. A second entry here would promise a safety with nothing to protect.
 *
 *   ./products   saving, deleting and publishing one
 *   ./inventory  what stock movement a status change implies
 *   ./reads      the predicate and shape every seller-facing catalogue read
 *                shares, so the phone and the admin cannot disagree about what
 *                is in a shop
 */
export * from "./products";
export * from "./inventory";
export * from "./reads";
