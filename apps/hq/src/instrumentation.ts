import { captureError, init } from "@sailo/observability";
import type { Instrumentation } from "next";

/**
 * The staff panel's boot check and error sink.
 *
 * Same shape as apps/web's and apps/api's, and deliberately so — all three
 * share a database and a signing secret, so they should fail the same way when
 * either is wrong. See `apps/web/src/instrumentation.ts` for why the env
 * import is dynamic.
 */
export async function register() {
  await import("./env");

  /*
   * The same sink the other two install, from the same package. Three servers
   * that share a database and a signing secret should be readable in one place
   * when any of them throws — `scope` is what tells them apart (`hq:` here,
   * `api:` and `web:` there), not which project the report landed in.
   */
  const { env } = await import("./env");
  const { startSentry } = await import("@sailo/observability/web");
  init(startSentry(env.SENTRY_DSN) ?? undefined);
}

/**
 * Server Components render here, unlike apps/api — so the digest matters. Next
 * replaces a thrown error with an opaque one before it reaches the client and
 * the digest is the only thing tying what the user saw to what actually threw.
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
    scope: `hq:${context.routeType}`,
    extra: {
      path: request.path,
      method: request.method,
      routePath: context.routePath,
      digest,
    },
  });
};
