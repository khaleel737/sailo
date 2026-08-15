/**
 * The legal facts, now in `@sailo/core/legal`.
 *
 * Kept as a re-export for the eleven files that import `@/lib/legal`. They had
 * to leave because the transactional email footer names the operator and links
 * the policies, and that footer is now built in `@sailo/email` — which two apps
 * send from and neither of which may reach into the other.
 *
 * A second copy would be worse than untidy: these are the strings that make a
 * receipt legally identifiable, and two of them disagreeing means one surface
 * is sending mail that names the wrong trading entity.
 */

export * from "@sailo/core/legal";
