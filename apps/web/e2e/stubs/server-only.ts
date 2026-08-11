/** See vitest.config.mts — the real package refuses to load outside a server component. */
/*
 * A value nobody imports, exported so the file is a module. `export {}` says
 * the same thing but the rule reads it as an oversight.
 */
export const SERVER_ONLY_STUB = true;
