/**
 * The seller's email switches, now in `@sailo/account/notification-prefs`.
 *
 * Kept as a re-export rather than deleted, for the same reason `plans.ts` is:
 * four modules and a test in this app import `@/lib/notification-prefs`, and
 * rewriting them would have put an unrelated diff in front of a move that
 * changes no behaviour. The schema itself had to leave — `packages/api` writes
 * this column for the phone's settings screen and cannot reach into
 * `apps/web` — and a second copy that drifts would decide, differently, which
 * keys are allowed into a column that governs whether someone gets emailed.
 */

export * from "@sailo/account/notification-prefs";
