/**
 * Selling something, in the seven questions a shop actually asks.
 *
 * WHY FOLDERS
 *
 * This was twenty-seven files flat in one directory with twenty-seven subpath
 * exports, and no statement anywhere about which of them belonged together. A
 * reader looking for "what happens when a booking is confirmed" had to open
 * `booking-claim`, `orders`, `tickets` and `event-access` to find out that
 * three of them were unrelated.
 *
 *   ./catalog      what is for sale, and how much of it is left
 *   ./orders       one purchase, from the lines it is made of through payment,
 *                  fulfilment and refund
 *   ./booking      time: opening hours, availability, slots, calendar feeds
 *   ./ticketing    admission: tickets, passes, and the door that reads them
 *   ./memberships  recurring access, and renewing it
 *   ./delivery     where a shop will send things, and what it charges
 *   ./coupons      discounts, and redeeming them exactly once
 *
 * WHY SOME CONTEXTS HAVE TWO ENTRIES AND SOME HAVE ONE
 *
 * `orders`, `booking`, `memberships` and `delivery` each hold rules a browser
 * legitimately renders — what a delivery zone covers, when a shop is open, what
 * an order's lines add up to — *and* the reads and writes behind them. Those
 * are split: `@sailo/commerce/orders` is safe anywhere, and
 * `@sailo/commerce/orders/server` is the database half.
 *
 * The split is not stylistic. While one barrel held both, `next build` refused
 * the storefront with `'server-only' cannot be imported from a Client Component
 * module` — a settings form asking for opening hours had pulled the
 * availability query in behind it.
 *
 * `catalog`, `ticketing` and `coupons` have one entry each, because every
 * module in them touches the database. A second entry there would be an empty
 * file promising a safety that has nothing to protect — and an empty barrel is
 * worse than none: `@sailo/commerce/ticketing` briefly became one, and
 * `DOOR_FILTERS` went undefined at runtime in a router that still typechecked.
 *
 * WHAT ARRIVED FROM apps/web
 *
 * `src/lib/orders` (eighteen files) and `src/lib/booking` (seven) were domain
 * logic living inside the website, which meant the phone could not reach any of
 * it. `connect.ts` came too, as `orders/card-checkout`: its 589 lines were
 * stuck in the app because they reach for order lines, memberships and checkout
 * lines, all of which are now here. It sits in `orders` rather than in
 * `@sailo/payments` deliberately — turning an order into Stripe line items is a
 * question about the order, and a capability package must not depend on a
 * domain one.
 */

export * from "./catalog";
export * from "./orders";
export * from "./booking";
export * from "./ticketing";
export * from "./memberships";
export * from "./delivery";
export * from "./coupons";
export * from "./pagination";
