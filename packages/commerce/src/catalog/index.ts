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
 *   ./low-stock  the claim that tells a seller once per crossing, and the reset
 *                without which one restock-and-resell cycle goes silent for
 *                ever — spec 51
 */
export * from "./products";
export * from "./inventory";
export * from "./reads";
export * from "./low-stock";
/**
 * `stock-requests` is the queue for something there is none of, and the ceiling
 * on selling it anyway — spec 33. It sends nothing and reports nothing about
 * what it found; both are deliberate.
 */
export * from "./stock-requests";
/**
 * `code-pool` is one product's pile of bearer tokens, and the conditional
 * claim that hands exactly one of them to exactly one order — spec 48. Nothing
 * in it ever returns an unclaimed code to a caller.
 */
export * from "./code-pool";
