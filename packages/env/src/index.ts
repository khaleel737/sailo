/**
 * The environment pieces that are shared rather than owned.
 *
 * Most variables belong to a package: `DATABASE_URL` to `@sailo/db`,
 * `REDIS_URL` to `@sailo/rate-limit`, the Stripe keys to `@sailo/payments`.
 * Each of those declares its own schema through a `keys()` export and each app
 * composes the ones it depends on, so nothing is asked for a variable it has
 * no use for.
 *
 * What is left over lives here: the secret both apps must agree on, and the
 * public values a browser and a native bundle both read under different
 * prefixes.
 */
export { keys } from "./keys";
export { clientEnv } from "./client";
