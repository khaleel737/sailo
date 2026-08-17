/**
 * WHY THIS IS A FOLDER
 *
 * 694 lines holding two readers, one upsert and five handlers. The handlers split by what the
 * event is *about* — the arrangement or the money — because those have different consequences: a
 * subscription changing is a fact to record, and an invoice failing is a member about to lose
 * access.
 *
 *   ./read       what Stripe actually sent, in whichever shape it sent it
 *   ./upsert     the convergence point all five events write through
 *   ./lifecycle  a subscription starting, changing, ending
 *   ./invoices   paid, or failed
 */

export * from "./read";
export * from "./upsert";
export * from "./lifecycle";
export * from "./invoices";
