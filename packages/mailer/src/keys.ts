import { onInvalidEnv } from "@sailo/env/report";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * The mail vendor's configuration, owned by the package that sends the mail.
 *
 * It was declared inline in `apps/web/src/env.ts` while that app was the only
 * sender. `apps/api` now serves the Resend webhook too, and an app that verifies
 * a signature needs the same secret validated the same way — declared twice is
 * how one of them ends up accepting an unsigned delivery because its schema was
 * the looser one.
 *
 * All optional. Absent means transactional mail is off, which the UI reports
 * rather than crashing: a preview deployment with no mail vendor is a real and
 * useful configuration.
 *
 * The three domains are separate on purpose. Marketing and transactional mail go
 * out on different sending domains so a broadcast complaint cannot take order
 * receipts down with it — a shared reputation means one seller's bad list stops
 * every other seller's buyer from getting a receipt.
 */
export const keys = () =>
  createEnv({
    server: {
      RESEND_API_KEY: z.string().startsWith("re_").optional(),
      /* Svix signs the webhook; this verifies it over the raw body. */
      RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),
      SAILO_MAIL_DOMAIN: z.string().min(1).optional(),
      SAILO_MKT_DOMAIN: z.string().min(1).optional(),
      SAILO_TX_DOMAIN: z.string().min(1).optional(),
      /** Where `email:preview` writes rendered mail. Local only. */
      EMAIL_PREVIEW_DIR: z.string().min(1).optional(),
    },
    runtimeEnv: process.env,
    onValidationError: onInvalidEnv,
    skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
    emptyStringAsUndefined: true,
  });
