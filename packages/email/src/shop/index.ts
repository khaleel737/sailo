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
/*
 * `./disputes` is a third thing: not the shop's trade and not its arrangements,
 * but a bank taking money back. Kept apart because it is the only mail here that
 * arrives with a deadline attached, and because nothing about it may be sent
 * behind a notification preference — see `@sailo/workflows/disputes`.
 */
export * from "./disputes";
