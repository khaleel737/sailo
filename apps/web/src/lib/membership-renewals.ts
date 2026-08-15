/**
 * Now in `@sailo/commerce/membership-renewals`.
 *
 * Kept as a re-export for the callers here. It left with the rest of what a
 * confirmed payment sets in motion: releasing a buyer's download, opening an
 * event's access, raising the invoice, and extending a manual membership. All
 * four are things the seller triggers by saying the money arrived — which is a
 * thing they do standing at a market stall, not only at a laptop.
 */

export * from "@sailo/commerce/membership-renewals";
export { runManualRenewals } from "@/lib/membership-cron";
