/*
 * Two entries, split by who may import them — the rule the rest of this
 * codebase follows, and for the same hard reason: a single barrel fails
 * `next build` the first time a client component reaches for a rule that
 * happens to sit beside a query.
 *
 * This one is the rules. `@sailo/commerce/recovery/server` is the rows and the
 * token.
 */
export * from "./rules";
