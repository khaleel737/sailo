/**
 * What a thing for sale can be.
 *
 * `variants` is the option/combination model — the kinds a product may take and
 * how its options multiply out. Pure, and bundled into the phone, because the
 * seller's editor builds the same combinations the storefront renders.
 */
export * from "./variants";
/**
 * `pricing-models` is the other half of what a thing costs: the buyer-chosen
 * amount and the window it is on sale in. Pure for the same reason — the buy
 * box, the basket, the storefront card and the admin form all have to agree
 * with `resolveLines` before the buyer reaches it.
 */
export * from "./pricing-models";
/**
 * `preorders` is what a buyer is offered when there is none of it: the queue
 * they can join, or the order they can place against stock that has not
 * arrived. Pure for the same reason — four surfaces decide it and only one of
 * them can refuse an order.
 */
export * from "./preorders";
