import { onInvalidEnv } from "./report";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * The variables both apps need and neither package owns.
 *
 * `BETTER_AUTH_SECRET` is the whole reason this package still exists. It is
 * read by better-auth's own default lookup rather than by any Sailo module, so
 * no leaf package can declare it — and it is shared by apps/web, which mints
 * sessions, and apps/api, which verifies them. Those two must be configured
 * with the *same* secret: a session signed by one and read by the other is
 * only valid because the HMAC matches. Configure them apart and apps/api
 * rejects every token apps/web issues, which presents as "the mobile app can't
 * log in" rather than as a mismatched secret.
 *
 * It is the second of the two genuinely required variables. Without it
 * better-auth cannot verify anything, so there is no degraded mode to fall
 * back to.
 */
export const keys = () =>
  createEnv({
    server: {
      BETTER_AUTH_SECRET: z.string().min(1),
      /*
       * Signs requests between Sailo's own deployments.
       *
       * There is exactly one such call today: apps/hq telling apps/web to drop
       * a shop out of its storefront cache, because staff have just suspended
       * that shop and a cached storefront would keep serving it. While the
       * panel lived inside apps/web that was a function call; across two
       * deployments it is an HTTP request, and a request that empties a cache
       * needs to prove it came from us.
       *
       * Optional, and its absence is a refusal rather than a bypass: the route
       * that reads it answers 503 when it is unset, so a misconfigured preview
       * fails loudly instead of accepting anonymous cache invalidation.
       */
      SAILO_INTERNAL_SECRET: z.string().min(1).optional(),
    },
    runtimeEnv: process.env,
    onValidationError: onInvalidEnv,
    skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
    emptyStringAsUndefined: true,
  });
