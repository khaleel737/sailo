/**
 * The emit machinery, now in `@sailo/commerce/webhooks`.
 *
 * Kept as a re-export rather than deleted: six modules in this app emit events,
 * none of them care where the queue writer lives, and a rename across all of
 * them would have hidden the actual change in a wide diff.
 *
 * It moved because the phone emits too. `orders.updateStatus` in `@sailo/api`
 * cancelled orders without firing `order.cancelled`, and `apps/api` cannot
 * import from this app — so the writer had to live somewhere both surfaces can
 * reach. `deliver.ts`, `post.ts` and `signature.ts` beside this file did not
 * move: they are the *sending* half, they run on a cron in this app only, and
 * nothing on a phone has any business making an outbound HTTP request to a
 * seller's endpoint.
 */

export * from "@sailo/commerce/webhooks";
