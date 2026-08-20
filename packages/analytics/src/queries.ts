/**
 * Dashboard figures: what sold, who visited, and where they came from.
 *
 * WHY THIS IS AN ENTRY AND NOT AN IMPLEMENTATION
 *
 * 607 lines holding five independent reads that shared nothing but their window helpers.
 * Nothing in it called anything else in it, which is the clearest signal available that it
 * was five files wearing one name.
 *
 *   ./bounds       what a window means (pure, and the only part testable without a replica)
 *   ./dashboard    the headline figures
 *   ./series       visits and revenue over time
 *   ./breakdowns   where visitors came from, and what they clicked
 *   ./performance  per-product views against sales
 *
 * Every read still goes to the replica. These are the widest scans in the codebase — a
 * window of visits and orders, grouped — they run on request rather than from cache, and
 * nothing in them decides whether a write happens. A seller seeing a count a second old is
 * not a bug; a checkout slowed by somebody else's dashboard is.
 */

export * from "./dashboard";
export * from "./series";
export * from "./breakdowns";
export * from "./performance";
export * from "./funnel";
export type { Window } from "./bounds";
