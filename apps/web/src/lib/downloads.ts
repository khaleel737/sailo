/**
 * Releasing a buyer's files, now in `@sailo/commerce/orders`.
 *
 * Kept as a re-export for the callers here. It left with the rest of what a
 * confirmed payment sets in motion: releasing a download, opening an event's
 * access, raising the invoice, extending a manual membership. All four are
 * things a seller triggers by saying the money arrived — which is a thing they
 * do standing at a market stall, not only at a laptop.
 *
 * Both halves, because this app has callers on each side: `hasReleasableDownloads`
 * is a rule an admin row renders, and `releaseDownloads` writes.
 */

export * from "@sailo/commerce/orders";
export * from "@sailo/commerce/orders/server";
