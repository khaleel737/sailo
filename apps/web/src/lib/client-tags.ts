/**
 * The client tag rules, now in `@sailo/core/client-tags`.
 *
 * Kept as a re-export rather than deleted: ten files import
 * `@/lib/client-tags`, and updating every one of them would be a diff about
 * import paths sitting on top of a diff about behaviour.
 *
 * They had to leave because `packages/api` lets a seller retag a customer from
 * their phone, and it cannot reach into `apps/web`. A second copy would be
 * dangerous rather than merely untidy: `normalizeTag` is what makes "VIP",
 * "vip" and " vip " one audience, and a broadcast selects its recipients by
 * `tags && '{vip}'`. Two foldings that disagreed would mean a seller mailing a
 * third of the people they meant to — and finding out from the open rate.
 */

export * from "@sailo/core/client-tags";
