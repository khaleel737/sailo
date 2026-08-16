import { onInvalidEnv } from "@sailo/env/report";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * The blob store's credential, owned by the package that uses it.
 *
 * It was declared inline in `apps/web/src/env.ts` and again in
 * `apps/api/src/env.ts`, which is how a variable ends up meaning two slightly
 * different things — one app optional, the other required, and nothing to say
 * which is right. It is one variable with one shape, so it is declared once
 * here and both apps extend it.
 *
 * Optional, like every other key that guards a feature: without it uploads
 * fail and nothing else does. A deployment with no blob store is a real
 * configuration for a preview or a fresh clone, and refusing to boot would
 * make the app useless exactly where booting matters most.
 *
 * The prefix is load-bearing rather than cosmetic. `./urls` parses the store id
 * out of this token to decide whether a stored URL points at *our* store rather
 * than merely *a* Vercel Blob store — every Vercel account on the internet gets
 * one, and without that check a seller could upload to their own and have our
 * download route stream arbitrary bytes back under our origin and certificate.
 * A token pasted in without its prefix silently falls back to the weaker check.
 */
export const keys = () =>
  createEnv({
    server: {
      BLOB_READ_WRITE_TOKEN: z.string().startsWith("vercel_blob_rw_").optional(),
    },
    runtimeEnv: process.env,
    onValidationError: onInvalidEnv,
    skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
    emptyStringAsUndefined: true,
  });
