import { onInvalidEnv } from "@sailo/env/report";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * The secrets the checks in this package verify against.
 *
 * `CRON_SECRET` is Vercel's: it signs every scheduled invocation, and
 * `cronAuthFailure` refuses a request without it. Without the check a cron route
 * is a public URL that makes the database re-run fleet-wide queries on demand —
 * which is why it is declared here, beside the function that reads it, rather
 * than inline in whichever app happens to host the schedule.
 *
 * `SAILO_STAFF_EMAILS` is the allowlist for the internal surfaces. Optional, and
 * an absent value means nobody is staff — the safe direction.
 */
export const keys = () =>
  createEnv({
    server: {
      CRON_SECRET: z.string().min(1).optional(),
      SAILO_STAFF_EMAILS: z.string().min(1).optional(),
    },
    runtimeEnv: process.env,
    onValidationError: onInvalidEnv,
    skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
    emptyStringAsUndefined: true,
  });
