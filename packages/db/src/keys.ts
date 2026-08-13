import { onInvalidEnv } from "@sailo/env/report";
import { urlWithProtocol } from "@sailo/env/schema";
import { createEnv } from "@t3-oss/env-core";

/**
 * The database's own environment, declared where the database is.
 *
 * A package that reads a variable is the package that knows what a valid one
 * looks like, so the schema lives beside the code rather than in a central
 * list that drifts from it. Each app composes the pieces it actually depends
 * on — which is why the mobile bundle is never asked for `DATABASE_URL`.
 *
 * `DATABASE_URL` is one of only two variables in the workspace that are
 * genuinely required. Everything else degrades: no Redis means no cache, no
 * Stripe key means billing is off. There is no degraded mode for "no
 * database", so this is the one place where failing at boot is strictly better
 * than failing at the first query.
 */
/** Neon and plain Postgres differ only in spelling; both are accepted. */
const postgres = urlWithProtocol(["postgres:", "postgresql:"], "Postgres");

export const keys = () =>
  createEnv({
    server: {
      DATABASE_URL: postgres,
      /*
       * Both spellings are read by `getDb`'s replica lookup, in this order.
       * Optional because a single-primary deployment is a supported shape, not
       * a misconfiguration.
       */
      DATABASE_URL_REPLICA: postgres.optional(),
      READ_REPLICA_URL: postgres.optional(),
      /** Local Neon proxy; absent everywhere except a laptop. */
      NEON_LOCAL_PROXY: urlWithProtocol(["http:", "https:"], "Neon proxy").optional(),
    },
    runtimeEnv: process.env,
    onValidationError: onInvalidEnv,
    skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
    emptyStringAsUndefined: true,
  });
