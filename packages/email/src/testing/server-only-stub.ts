/**
 * Stands in for `server-only` under vitest. See `vitest.config.mts`.
 *
 * The real package throws outside a React server component, which is correct
 * everywhere except a test that is deliberately rendering a message to HTML.
 */
export const SERVER_ONLY_STUB = true;
