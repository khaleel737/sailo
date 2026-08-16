import * as Sentry from "@sentry/node";
import type { Sink } from "./seam";

/**
 * Where a server error actually goes.
 *
 * THE GAP THIS CLOSES
 *
 * `apps/web/src/instrumentation.ts` has called `init()` with no arguments since
 * it was written, and its own comment said what that meant: "today it logs".
 * So an exception in a Server Component, a Route Handler or a Server Action was
 * a line in a Vercel log nobody reads. The phone has had a real reporter since
 * `@sentry/react-native` landed; the two servers that take every payment have
 * not. This is the half that was missing.
 *
 * WHY `@sentry/node` AND NOT `@sentry/nextjs`
 *
 * `@sentry/nextjs` is the fuller integration — it also catches errors in the
 * browser and uploads source maps — but it does that by wrapping `next.config`
 * with a build plugin and adding client and edge config files to each app. That
 * is a build-system change to two apps, and it buys nothing for the errors that
 * are actually invisible today, which are all server-side: `onRequestError` is
 * a server hook and every `captureError` call in `packages/*` runs on a server.
 *
 * `@sentry/node` is the plain SDK with no build coupling. Client-side web
 * errors remain uncovered, and that is a stated gap rather than an oversight —
 * closing it is a later, separate change with its own config to review.
 *
 * The scrubbing below is the same policy as `./native`, deliberately: two
 * reporters that disagree about what counts as personal data means the stricter
 * one is decorative.
 */

/**
 * Anything that identifies a person, dropped before it leaves the server.
 *
 * Sailo's error context carries a `scope` and sometimes an opaque id, and those
 * are fine — an id correlates two reports without naming anybody. What must
 * never be sent is what a seller or their buyer typed: an email, a handle, an
 * order's contents. Sentry's own `sendDefaultPii` is off and stays off; this is
 * the second line, for the fields Sailo attaches itself.
 */
const PII_KEYS = /email|phone|address|name|handle|token|secret|password|card/i;

function scrub(extra: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!extra) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (PII_KEYS.test(key)) continue;
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      /*
       * Truncated: a long string here is either a payload or a message, and
       * both are ways for content to escape one character at a time.
       */
      out[key] = typeof value === "string" ? value.slice(0, 200) : value;
    }
  }
  return out;
}

function tagsFor(context: { scope?: string; shopId?: string } | undefined) {
  return {
    scope: context?.scope ?? "unknown",
    ...(context?.shopId ? { shop_id: context.shopId } : null),
  };
}

/**
 * Start Sentry and hand back a sink for `init`, or null when no DSN is set.
 *
 * Null rather than a no-op sink, so the caller keeps the console sink instead.
 * A reporter that silently discards is worse than an obviously-local one, and
 * local dev, CI and preview deploys all want the console. This is why nothing
 * has to be configured for the monorepo to be useful.
 */
export function startSentry(dsn: string | undefined): Sink | null {
  if (!dsn) return null;

  const production = process.env.NODE_ENV === "production";

  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    /*
     * The commit the server is running, so a stack trace can be read against
     * the right source. Vercel sets this on every deployment; absent locally,
     * where the running code is whatever is checked out.
     */
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    /*
     * Off, and deliberately. Sentry's default PII includes the request's IP
     * address and headers, neither of which helps read a stack trace, and both
     * of which turn an error log into a record of who was shopping where.
     */
    sendDefaultPii: false,
    /*
     * Sampled. Errors are never sampled — this is the performance side only,
     * and a trace per request on a storefront under load is a bill rather than
     * a signal.
     */
    tracesSampleRate: production ? 0.1 : 0,
    /*
     * In development the stack trace is already in the terminal, and shipping
     * every hot-reload error to a shared project makes the real ones
     * unfindable.
     */
    enabled: production,
  });

  return {
    captureError(error, context) {
      const err = error instanceof Error ? error : new Error(String(error));
      Sentry.captureException(err, {
        tags: tagsFor(context),
        extra: scrub(context?.extra),
      });
    },
    captureMessage(message, severity = "info", context) {
      Sentry.captureMessage(message, {
        level: severity === "warning" ? "warning" : severity,
        tags: tagsFor(context),
        extra: scrub(context?.extra),
      });
    },
  };
}
