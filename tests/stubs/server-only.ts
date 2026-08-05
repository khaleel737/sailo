/**
 * `server-only` throws on import outside a React Server Component, which is
 * exactly its job — and exactly what makes it unloadable in a plain test.
 * Aliased here so server modules can be unit-tested; the real guard still
 * applies in the app, where the bundler resolves the real package.
 */
export {};
