/**
 * Draining the delivery queue.
 *
 * WHY THIS IS AN ENTRY AND NOT AN IMPLEMENTATION
 *
 * It was 505 lines carrying five jobs, and its own section banners named all five: the
 * numbers, one tick, one delivery, giving up on an endpoint, and pruning. The retry
 * schedule in particular is pure arithmetic that had never been asserted, because
 * reaching it meant mocking a database, a signer and an HTTP client.
 *
 *   ./policy   the numbers, and the two decisions they encode
 *   ./queue    one tick: what is due, grouped by endpoint, drained in sequence
 *   ./claim    the lease that makes two overlapping ticks disjoint
 *   ./attempt  sign, post, record
 *   ./disable  switching an endpoint off once, and telling the seller
 *   ./prune    dropping delivery rows older than the log's own window
 *   ./rows     the joined row shape, so ./queue and ./attempt need not import each other
 *
 * `@sailo/workflows/webhooks` still resolves here, so no caller moved.
 */

export * from "./policy";
export * from "./queue";
export * from "./prune";
export type { EndpointRow } from "./rows";
