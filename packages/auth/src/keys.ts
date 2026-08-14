import { onInvalidEnv } from "@sailo/env/report";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * Apple's and Google's sign-in credentials, all optional and all shape-checked.
 *
 * Optional because social sign-in is additive: a deployment with none of these
 * set runs with `emailAndPassword` exactly as it does today and simply offers
 * no provider buttons. That is a real configuration — a preview deployment, a
 * fresh clone, and every environment before the Apple and Google consoles are
 * set up. Requiring them would make the app refuse to boot in the environments
 * where booting matters most. Same reasoning as `@sailo/payments`' keys.
 *
 * What validation buys instead is shape, because **every value here is an
 * opaque string that looks like every other one**, and Apple hands out four of
 * them at once. Pasting the App ID where the Services ID belongs is the single
 * most common way an Apple integration fails, and it fails as "invalid_client"
 * from Apple on the return leg — which reads as "Sign in with Apple is broken"
 * rather than as "these two identifiers are the wrong way round".
 */
export const keys = () =>
  createEnv({
    server: {
      /*
       * The **Services ID**, not the App ID.
       *
       * Apple issues two reverse-DNS identifiers per app and they are not
       * interchangeable. The Services ID (`store.sailo.signin`) identifies the
       * *web* OAuth client and is what the browser flow authenticates as; the
       * App ID / bundle identifier (`store.sailo.app`) identifies the *native*
       * app and is what a device-issued identity token is audienced to. They
       * must be different strings — `appleSignIn()` in apps/web refuses to
       * configure the provider when they are equal, because the only way that
       * happens is that one was pasted into the other's variable.
       */
      APPLE_CLIENT_ID: z.string().min(1).optional(),
      /** Ten characters, from Apple Developer → Membership details. */
      APPLE_TEAM_ID: z.string().length(10).optional(),
      /** Ten characters, shown once when the `.p8` key is created. */
      APPLE_KEY_ID: z.string().length(10).optional(),
      /*
       * The contents of the `.p8` sign-in key — a PEM block, not a JWT.
       *
       * Apple's "client secret" is a short-lived ES256 token minted *from* this
       * key rather than a value Apple gives you; `appleClientSecret()` in
       * apps/web does the minting on boot. The check is for the PEM armour
       * because the plausible mistake is pasting a previously minted JWT here,
       * which would validate against `min(1)` and then fail to sign anything.
       *
       * Multi-line values survive a platform environment variable as literal
       * `\n`; the minting code accepts either form.
       */
      APPLE_PRIVATE_KEY: z.string().includes("PRIVATE KEY").optional(),
      /*
       * `store.sailo.app` — the native bundle identifier, used as the expected
       * `aud` when the mobile app signs in with a device-issued identity token
       * instead of walking the browser flow.
       */
      APPLE_APP_BUNDLE_IDENTIFIER: z.string().min(1).optional(),

      /*
       * Google's are self-describing, which is the point of checking the
       * suffix: a client *secret* pasted into the client *id* fails here at
       * boot rather than as a mismatch on the token exchange.
       */
      GOOGLE_CLIENT_ID: z
        .string()
        .endsWith(".apps.googleusercontent.com")
        .optional(),
      GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    },
    runtimeEnv: process.env,
    onValidationError: onInvalidEnv,
    skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
    emptyStringAsUndefined: true,
  });
