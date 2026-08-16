/**
 * What the people running a shop are told.
 *
 * `./seller` is the shop's trade — an order arrived, a booking needs
 * answering, a webhook was switched off. `./messages` is its arrangements — an
 * affiliate approved, payout details changed. Both go to a seller or their
 * partners; neither ever goes to a buyer.
 */
export * from "./seller";
export * from "./messages";
