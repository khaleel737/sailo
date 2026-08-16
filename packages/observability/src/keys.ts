import { onInvalidEnv } from "@sailo/env/report";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * Where reports are sent, if anywhere.
 *
 * Optional, and the absence is a supported configuration rather than a
 * misconfiguration: with no DSN the sinks return null and `init` keeps the
 * console sink, which is what CI, previews and a fresh clone want. Nothing in
 * this repo requires a vendor account to be useful.
 *
 * One variable for both servers. The phone reads its own through
 * `expo-constants` rather than `process.env`, because a native bundle has no
 * environment to read at runtime — see `./native`.
 */
export const keys = () =>
  createEnv({
    server: {
      SENTRY_DSN: z.string().url().optional(),
    },
    runtimeEnv: process.env,
    onValidationError: onInvalidEnv,
    skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
    emptyStringAsUndefined: true,
  });
