/*
 * `server-only` throws on import outside a React Server Component, which is
 * exactly what stops a server module from being unit-tested. Vitest aliases the
 * real package to this one — see `../vitest.base.mts`.
 *
 * The module has to exist, resolve, and do nothing. A bare `export {}` says that
 * but trips `unicorn/require-module-specifiers`, and an empty file trips
 * `unicorn/no-empty-file`, so it exports one unused constant instead. That is
 * the smallest thing that is unambiguously deliberate to both a linter and a
 * reader.
 */
export const SERVER_ONLY_STUB = true;
