/**
 * Sending partners their money.
 *
 * The money moves as a plain Stripe **transfer** from Sailo's platform balance
 * to the partner's connected account — no charge behind it, no `transfer_group`,
 * no `source_transaction`. Stripe documents this exact case: *"You can also
 * make a transfer with neither an associated charge nor a transfer_group — for
 * example, when you must pay a provider but there's no associated customer
 * payment."* A partner's commission is not a slice of one buyer's payment; it
 * is a slice of a month of subscription revenue that has already settled into
 * our balance.
 *
 * The ordering below is the whole design, and it is ordered to survive a crash
 * at any line:
 *
 *   1. Write the payout row `pending`, carrying the idempotency key we are
 *      *about to* send Stripe.
 *   2. **Claim** the ledger rows by stamping `payout_id` on them, atomically.
 *   3. Re-total from what was actually claimed, not from what was read.
 *   4. Call Stripe.
 *   5. Stamp `paid_out_at` on the claimed rows, or release the claim on failure.
 *
 * Writing the row first is what makes a crash recoverable: a `pending` row
 * names an attempt whose outcome we do not know, and `reconcilePendingPayouts`
 * asks Stripe with the same key rather than guessing. Creating it *after* the
 * transfer would lose exactly the cases worth keeping.
 *
 * Claiming before totalling is what makes it correct under concurrency: an
 * earning that matures between the read and the transfer is either claimed by
 * this run or left for the next one, never both and never neither.
 *
 * WHY THIS IS A FOLDER
 *
 * 556 lines in which one function moved money and five did not, and nothing in the file said
 * which was which until you had read it. That distinction is the split:
 *
 *   ./refusals    the words HQ reads when a payout cannot happen
 *   ./balances    what each partner is owed (read-only)
 *   ./claim       the two writes that are not the transfer
 *   ./pay         paying one partner, once — the irreversible step
 *   ./run         the scheduled sweep over everybody due
 *   ./reconcile   asking Stripe about the ones a crash left pending
 *   ./history     a partner's own record, for their portal
 */

export * from "./balances";
export * from "./pay";
export * from "./run";
export * from "./reconcile";
export * from "./history";
