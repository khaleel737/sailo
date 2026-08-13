import { onInvalidEnv } from "@sailo/env/report";
import { urlWithProtocol } from "@sailo/env/schema";
import { createEnv } from "@t3-oss/env-core";

/**
 * Redis, which is optional on purpose.
 *
 * `withRedis` falls back to the caller's default whenever Redis is not
 * configured or not reachable, so a deployment without it loses caching and
 * distributed rate limiting but still serves every request. Making this
 * required would turn a graceful degradation into an outage.
 *
 * What validation buys here is the other failure: a `REDIS_URL` that is set
 * but malformed. That one is silent today — the client fails to connect, every
 * call falls back, and the only symptom is that nothing is ever cached.
 */
export const keys = () =>
  createEnv({
    server: {
      REDIS_URL: urlWithProtocol(["redis:", "rediss:"], "Redis").optional(),
    },
    runtimeEnv: process.env,
    onValidationError: onInvalidEnv,
    skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
    emptyStringAsUndefined: true,
  });
