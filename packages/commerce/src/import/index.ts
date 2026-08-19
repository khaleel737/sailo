/**
 * Moving a catalogue in from somewhere else — spec 47.
 *
 * *"One write path, six readers."* Each source is a **fetcher** and a
 * **mapper** that produce `SourceBatch`; `plan.ts` turns that into a preview
 * with a verdict per row; `run.ts` executes the plan through `saveProduct`,
 * the same function the admin form and the phone use.
 *
 * Everything reachable from here except `./fetch` and `./run` is pure, which is
 * what lets `plan.test.ts` exercise every mapping decision that costs money —
 * how a price is parsed, whether a re-run duplicates, what happens at a plan
 * ceiling — from object literals.
 *
 * The two rules that are not negotiable and are enforced by what is *absent*:
 * nothing here writes an order, and nothing here grants marketing consent.
 */

export * from "./rows";
export * from "./plan";
export * from "./sources/shopify";
export * from "./sources/stripe";
export * from "./sources/tabular";
