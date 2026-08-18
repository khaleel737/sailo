/*
 * Two entries, split by who may import them.
 *
 * This one holds only the modules with no `server-only` in them — the
 * vocabulary of the list and the renderer the composer's preview pane runs.
 * The database half is `@sailo/marketing/newsletter/server`.
 *
 * The split is not stylistic: a single barrel fails `next build` with
 * `'server-only' cannot be imported from a Client Component module` the first
 * time any client component reaches for a constant that happens to sit beside
 * a query. See `docs/architecture.md`.
 */
export * from "./list";
export * from "./render";
export {
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  normalizeEmail,
  normalizeName,
} from "../contact";
