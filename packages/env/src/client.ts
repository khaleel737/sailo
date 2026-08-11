import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * Public environment — the only variables a browser or a mobile bundle may
 * see. Anything here is shipped to the client, so it holds URLs and public
 * keys, never a secret. The `NEXT_PUBLIC_`/`EXPO_PUBLIC_` split is deliberate:
 * each runtime only inlines its own prefix, so the same shape is fed from
 * whichever the current app exposes.
 */
export const clientEnv = createEnv({
  clientPrefix: "PUBLIC_",
  client: {
    PUBLIC_APP_URL: z.string().url().optional(),
  },
  runtimeEnv: {
    PUBLIC_APP_URL:
      process.env.NEXT_PUBLIC_APP_URL ?? process.env.EXPO_PUBLIC_APP_URL,
  },
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
  emptyStringAsUndefined: true,
});
