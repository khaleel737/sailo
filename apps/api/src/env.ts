import { onInvalidEnv } from "@sailo/env/report";
import { keys as db } from "@sailo/db/keys";
import { keys as shared } from "@sailo/env/keys";
import { keys as rateLimit } from "@sailo/rate-limit/keys";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * What the API app needs, checked once at boot.
 *
 * Much shorter than apps/web's, and that is the split working: this app reads
 * sessions and serves JSON, so it needs the database, the shared auth secret
 * and Redis — and none of the mail, Stripe or storage configuration that
 * apps/web carries.
 *
 * `BETTER_AUTH_SECRET` arrives through `@sailo/env` rather than being declared
 * here, which is the point of putting it there: both apps read the same schema
 * for it, so the two cannot drift into verifying tokens against different
 * secrets.
 */
export const env = createEnv({
  extends: [db(), shared(), rateLimit()],
  server: {
    /*
     * Browser origins allowed to call the tRPC endpoint. Empty is the correct
     * default — the only client today is the native app, and a native fetch is
     * not subject to CORS at all. Validated as a plain string because it is a
     * comma-separated list the route parses itself; `*` is rejected there, not
     * here, because the reason it is refused is a security rule rather than a
     * shape.
     */
    API_ALLOWED_ORIGINS: z.string().optional(),
  },
  runtimeEnv: process.env,
  onValidationError: onInvalidEnv,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
  emptyStringAsUndefined: true,
});
