import { onInvalidEnv } from "@sailo/env/report";
import { keys as db } from "@sailo/db/keys";
import { keys as shared } from "@sailo/env/keys";
import { keys as mailer } from "@sailo/mailer/keys";
import { keys as observability } from "@sailo/observability/keys";
import { keys as payments } from "@sailo/payments/keys";
import { keys as rateLimit } from "@sailo/rate-limit/keys";
import { keys as security } from "@sailo/security/keys";
import { keys as storage } from "@sailo/storage/keys";
import { createEnv } from "@t3-oss/env-core";

/**
 * What the staff panel needs from the environment, checked once at boot.
 *
 * Composed rather than listed, like the other two apps: each package declares
 * the variables it reads and this app adds only what it owns itself — which,
 * so far, is nothing. Every variable below arrives through a package.
 *
 * WHAT THIS APP NEEDS THAT apps/api DOES NOT
 * `mailer`, because this app mints the staff sign-in link and has to send it.
 * That is the one capability the split deliberately gave this app and took
 * away from apps/web: `magicLink` only ever served staff, so it moved here
 * whole rather than being duplicated.
 *
 * WHAT IT NEEDS THAT apps/web DOES NOT
 * Nothing. This is a strict subset — no `SAILO_WEBHOOK_SECRET` (it signs no
 * outbound seller webhooks), no `ANALYTICS_SALT` (it hashes no visitors), no
 * broadcast ceilings (it sends no campaigns). Those stayed with the app that
 * owns those jobs.
 *
 * `BETTER_AUTH_SECRET` and `DATABASE_URL` arrive through `@sailo/env` and
 * `@sailo/db` rather than being declared here, which is the whole point of
 * putting them there: all three apps read one schema for them, so they cannot
 * drift into signing tokens against different secrets or pointing at
 * different databases.
 */
export const env = createEnv({
  extends: [
    db(),
    shared(),
    mailer(),
    observability(),
    payments(),
    rateLimit(),
    security(),
    storage(),
  ],
  server: {},
  runtimeEnv: process.env,
  onValidationError: onInvalidEnv,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
  emptyStringAsUndefined: true,
});
