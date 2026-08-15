/**
 * The country list, now in `@sailo/core/countries`.
 *
 * Kept as a re-export: eleven files import `@/lib/countries`, and the barrel
 * next door re-exports this too. It had to leave because a seller edits their
 * shipping zones from the phone, and `packages/api` cannot reach into
 * `apps/web` — `parseCountries` is what turns whatever arrives into codes, and
 * a second copy of that is a zone check that disagrees with the one the
 * storefront runs.
 */

export * from "@sailo/core/countries";
