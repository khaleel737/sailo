/**
 * The /hq security page's reads.
 *
 * WHY THIS IS A FOLDER
 *
 * 790 lines answering three separate questions with three separate shapes: the headline figures,
 * the session list, and the live-session subqueries. Nothing in it called anything else in it
 * except the one `PAID` predicate, which now has its own module so the two things that ask "is
 * this shop paying" cannot drift apart.
 *
 *   ./paid      what counts as a paying shop
 *   ./overview  the headline figures, and sign-ins over time
 *   ./sessions  who is signed in — filtered, paged, exportable
 *   ./live      live sessions, and where they are coming from
 */

export * from "./overview";
export * from "./sessions";
export * from "./live";
