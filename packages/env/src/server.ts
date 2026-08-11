import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * Server environment, validated once at boot.
 *
 * The point of this package in a monorepo is that a missing or malformed
 * variable becomes a clear failure at startup — with the offending key named —
 * rather than a `undefined` that surfaces as a 3am runtime crash three calls
 * deep. Each app composes the pieces it needs; nothing here reads
 * `process.env` directly at a call site again.
 *
 * Only the shared, cross-app variables live here. App-specific ones (a cron
 * secret, a webhook signing key) are declared where they are used, extending
 * this schema, so the mobile app is never asked for the web app's secrets.
 */
export const serverEnv = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(1),
    RESEND_API_KEY: z.string().min(1).optional(),
    REDIS_URL: z.string().url().optional(),
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
  },
  runtimeEnv: process.env,
  // A preview/CI build may legitimately lack the optional secrets; the app's
  // own guards fail closed at the point of use, which is the safer place.
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
  emptyStringAsUndefined: true,
});
