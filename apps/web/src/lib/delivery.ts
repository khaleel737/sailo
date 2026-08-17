/**
 * The delivery rules, now in `@sailo/commerce/delivery`.
 *
 * `shipsTo` is why a second copy would be dangerous rather than untidy: the
 * checkout panel narrows what a buyer may choose with it, the order action
 * re-checks with it, and the seller's phone lists zones with it. Three readings
 * of "does this shop post here" that could disagree is a buyer being offered a
 * delivery the order will then refuse.
 *
 * **The client-safe half only.** `delivery-rate-form.tsx` is a client component
 * and imports this for the rule; re-exporting the zone queries alongside it
 * failed the build with `'server-only' cannot be imported from a Client
 * Component module`. Anything that needs to read or write zones imports
 * `@sailo/commerce/delivery/server` and says so.
 */

export * from "@sailo/commerce/delivery";
