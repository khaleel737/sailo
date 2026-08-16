import { captureError, init } from "@sailo/observability";
import type { Instrumentation } from "next";

/**
 * The API app's boot check and error sink.
 *
 * Same shape as apps/web's, and deliberately so — the two apps share a
 * database and a signing secret, so they should fail the same way when either
 * is wrong. See `apps/web/src/instrumentation.ts` for why the env import is
 * dynamic.
 */
export async function register() {
  const { env } = await import("./env");

  /*
   * The same sink apps/web installs, from the same package. Two servers that
   * share a database and a signing secret should be readable in one place when
   * either of them throws — `scope` is what tells them apart (`api:` here,
   * `web:` there), not which project the report landed in.
   */
  const { startSentry } = await import("@sailo/observability/web");
  init(startSentry(env.SENTRY_DSN) ?? undefined);
}

/**
 * Everything here is a route handler, so there is no Server Components render
 * to lose the original error to — but the digest is carried anyway, because
 * `global-error` boundaries elsewhere in the app can still produce one and a
 * report that sometimes omits its correlation id is worse than one that never
 * does.
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
    scope: `api:${context.routeType}`,
    extra: {
      path: request.path,
      method: request.method,
      routePath: context.routePath,
      digest,
    },
  });
};
