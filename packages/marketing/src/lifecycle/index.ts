/*
 * Two entries, split by who may import them.
 *
 * This one holds only the modules with no `server-only` in them. The database
 * half is `@sailo/marketing/lifecycle/server`.
 *
 * The split is not stylistic: a single barrel fails `next build` with
 * `'server-only' cannot be imported from a Client Component module` the first
 * time any client component reaches for a rule that happens to sit beside a
 * query. See `docs/architecture.md`.
 */
export * from "./steps";
