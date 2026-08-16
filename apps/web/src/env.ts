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
 * Everything apps/web needs from the environment, checked once at boot.
 *
 * Composed rather than listed: each package declares the variables it reads,
 * and this adds only the ones the app itself owns. `instrumentation.ts` imports
 * the result, so a missing `DATABASE_URL` or a Stripe secret pasted into the
 * webhook variable stops the server starting — with the offending key named —
 * instead of surfacing as a failed query or a signature mismatch on live
 * traffic hours later.
 *
 * **Optional is the default, and deliberately so.** Only `DATABASE_URL` and
 * `BETTER_AUTH_SECRET` are required, because only those two have no degraded
 * mode. Every other variable here guards a feature that switches itself off
 * when it is absent — no Resend key means no mail, no cron secret means the
 * cron routes refuse — and turning those into boot failures would make a
 * preview deployment impossible to run. What validation buys for them is
 * shape: a value that is set but wrong is the failure that hides.
 *
 * Scope: server variables only. `NEXT_PUBLIC_*` values are inlined by the
 * bundler and are public by definition, so a missing one degrades visibly
 * (no analytics tag) rather than silently. Tooling-only variables — the
 * `SCENARIO_*`, `E2E_*` and `CHECK_*` families read by scripts and never by
 * `src/` — are deliberately absent; declaring them would make a production
 * boot answer for a variable only a laptop ever sets.
 */
export const env = createEnv({
  extends: [db(), shared(), observability(), payments(), rateLimit(), storage()],
  server: {
    /** Guards the nightly rollup and every other Vercel cron route. */
    CRON_SECRET: z.string().min(1).optional(),

    /* Mail. Absent means transactional mail is off, which the UI reports. */
    RESEND_API_KEY: z.string().startsWith("re_").optional(),
    RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),
    /*
     * Marketing and transactional mail go out on separate domains so a
     * broadcast complaint cannot take order receipts down with it.
     */
    SAILO_MAIL_DOMAIN: z.string().min(1).optional(),
    SAILO_MKT_DOMAIN: z.string().min(1).optional(),
    SAILO_TX_DOMAIN: z.string().min(1).optional(),

    /** Comma-separated addresses that may reach the staff surfaces. */
    SAILO_STAFF_EMAILS: z.string().min(1).optional(),
    /** Signs outbound seller webhooks. */
    SAILO_WEBHOOK_SECRET: z.string().min(1).optional(),
    /** Salts visitor hashes, so analytics cannot be reversed to a person. */
    ANALYTICS_SALT: z.string().min(1).optional(),

    /*
     * Send ceilings. Coerced because the environment only carries strings, and
     * a non-numeric value here would otherwise become `NaN` — which compares
     * false against every count and silently lifts the ceiling entirely.
     */
    BROADCAST_DAILY_CEILING: z.coerce.number().int().positive().optional(),
    LIFECYCLE_DAILY_CEILING: z.coerce.number().int().positive().optional(),

    /** Where `email:preview` writes rendered mail. Local only. */
    EMAIL_PREVIEW_DIR: z.string().min(1).optional(),
  },
  runtimeEnv: process.env,
  onValidationError: onInvalidEnv,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
  emptyStringAsUndefined: true,
});
