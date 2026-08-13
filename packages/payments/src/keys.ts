import { onInvalidEnv } from "@sailo/env/report";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * Stripe's keys, all optional and all shape-checked.
 *
 * Optional because `billingEnabled()` exists: a deployment with no Stripe key
 * runs with payments switched off, which is a real configuration for a preview
 * or a fresh clone. Requiring them would make the app refuse to boot in the
 * environments where it is most useful to boot.
 *
 * The prefixes are the point. A Stripe secret and a Stripe webhook secret are
 * both opaque strings, and pasting one into the other's variable is a mistake
 * no type can catch and no test would see — it fails as a signature mismatch
 * on live traffic, which reads as "Stripe is broken" rather than "these two
 * values are swapped". `startsWith` catches it at boot.
 */
export const keys = () =>
  createEnv({
    server: {
      STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
      /*
       * A comma-separated list, so that a secret can be rotated without a
       * window where half the deliveries fail. The whole string still begins
       * with the first secret's prefix.
       */
      STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
      STRIPE_CONNECT_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
      /*
       * The platform's own connected account. `sendingAccount` resolves a
       * missing `account` field on an event to this id, so a typo here does
       * not error — it silently stops one shop's events from ever matching
       * their orders.
       */
      STRIPE_PLATFORM_ACCOUNT_ID: z.string().startsWith("acct_").optional(),
    },
    runtimeEnv: process.env,
    onValidationError: onInvalidEnv,
    skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
    emptyStringAsUndefined: true,
  });
