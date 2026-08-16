import { captureError, init } from "@sailo/observability";
import type { Instrumentation } from "next";

/**
 * The two things that must happen before this app serves anything.
 *
 * Next calls `register` once per server instance and waits for it, which makes
 * it the only place where "fail at boot" is actually available. Both jobs here
 * are about the same failure mode: a problem that would otherwise be invisible
 * until a seller hits it.
 */

/**
 * Validate the environment, then point errors somewhere.
 *
 * The import is dynamic on purpose. `env.ts` validates at module scope, so a
 * static import would run the check while this module is being linked — before
 * the try/catch below exists — and the process would die with a stack trace
 * from inside a validator rather than the readable summary `@t3-oss/env-core`
 * prints. Importing inside the function keeps the failure ours to describe.
 */
export async function register() {
  const { env } = await import("./env");

  /*
   * One call, at the app's entry, and the moment the seam pays for itself.
   *
   * `startSentry` returns null when `SENTRY_DSN` is unset, and `init` falls
   * back to the console sink — so CI, previews and a fresh clone keep working
   * with nothing configured, while a deployment that has a DSN starts
   * reporting every `captureError` call already written, in this app and in
   * every package it imports, without one of them changing.
   *
   * The sink is imported dynamically for the same reason `./env` is: it pulls
   * `@sentry/node`, and nothing should load an APM agent while this module is
   * still being linked.
   */
  const { startSentry } = await import("@sailo/observability/web");
  init(startSentry(env.SENTRY_DSN) ?? undefined);
}

/**
 * Server errors, reported rather than merely logged.
 *
 * This is the gap that mattered: an exception in a Server Component, a Route
 * Handler or a Server Action was a line in a Vercel log nobody reads, so the
 * first sign that the send-gate had paused a shop wrongly would be the seller
 * saying so. Everything Next catches on the server now goes through the same
 * seam the mobile app already uses.
 *
 * `digest` is carried because React replaces the thrown error with an opaque
 * one when it happens during a Server Components render — the digest is the
 * only handle that ties the sanitised client-side message back to this report.
 */
export const onRequestError: Instrumentation.onRequestError = (
  err,
  request,
  context,
) => {
  const digest =
    typeof err === "object" && err !== null && "digest" in err
      ? String((err as { digest: unknown }).digest)
      : undefined;

  captureError(err, {
    scope: `web:${context.routeType}`,
    extra: {
      path: request.path,
      method: request.method,
      routePath: context.routePath,
      routerKind: context.routerKind,
      renderSource: context.renderSource,
      revalidateReason: context.revalidateReason,
      digest,
    },
  });
};
