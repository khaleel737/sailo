import { onInvalidEnv } from "@sailo/env/report";
import { keys as db } from "@sailo/db/keys";
import { keys as shared } from "@sailo/env/keys";
import { keys as payments } from "@sailo/payments/keys";
import { keys as rateLimit } from "@sailo/rate-limit/keys";
import { keys as observability } from "@sailo/observability/keys";
import { keys as storage } from "@sailo/storage/keys";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * What the API app needs, checked once at boot.
 *
 * Still much shorter than apps/web's, and that is the split working: this app
 * reads sessions and serves JSON, so it needs the database, the shared auth
 * secret and Redis — and none of the mail configuration apps/web carries.
 *
 * Stripe and Blob arrived with the phone's payments and uploads procedures.
 * `payments.connectLink` opens a seller's connected account and
 * `uploads.token` signs a blob upload, and both of those are things this app
 * now does itself rather than proxies — so a key that is absent or pasted into
 * the wrong variable has to fail here, at boot, with the offending name, and
 * not as an unexplained error the first time a seller taps "get paid".
 *
 * `BETTER_AUTH_SECRET` arrives through `@sailo/env` rather than being declared
 * here, which is the point of putting it there: both apps read the same schema
 * for it, so the two cannot drift into verifying tokens against different
 * secrets.
 */
export const env = createEnv({
  extends: [db(), shared(), observability(), payments(), rateLimit(), storage()],
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
