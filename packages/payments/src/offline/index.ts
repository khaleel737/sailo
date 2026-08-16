/**
 * Every way of getting paid that is not a card — the half a browser may hold.
 *
 * Not a lesser case: in the markets Sailo sells into it is the only case for
 * most shops, and `isRailUsable` is what decides whether a seller who takes
 * cash is told their shop can be paid at all.
 *
 * `./settings` is deliberately **not** re-exported here. It reads and writes
 * `paymentMethods` and carries `server-only`, while what is below is rendered
 * inside the storefront's checkout panel — a client component. A barrel that
 * held both failed the build with `'server-only' cannot be imported from a
 * Client Component module`, which is the correct answer to the wrong shape:
 * the rails a shop offers and the configuration behind them are two different
 * questions with two different audiences.
 *
 * So the split is by who may ask:
 *
 *   @sailo/payments/offline           what the rails are, and what the buyer
 *                                     is shown once they pick one — anywhere
 *   @sailo/payments/offline/settings  reading and writing what a shop has
 *                                     configured — server only
 */
export * from "./rails";
export * from "./handoff";
