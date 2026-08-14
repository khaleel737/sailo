/**
 * The outside world's vocabulary, now in `@sailo/core/resources`.
 *
 * Kept as a re-export rather than deleted, for the reason `lib/plans.ts` gives:
 * the REST endpoints, the OpenAPI document and the docs pages all import
 * `@/lib/api/resources`, and rewriting every one of them would have put a wide
 * diff in front of a move that changes no behaviour.
 *
 * The shapes themselves had to leave. A webhook payload is built once, at the
 * moment the event happens, and stored on the delivery row — so whichever
 * surface the seller was holding has to build it, and `@sailo/api` runs in
 * `apps/api`, which cannot import from this app. A second copy would be a
 * consumer's field map breaking depending on whether the seller used a phone.
 */

export * from "@sailo/core/resources";
