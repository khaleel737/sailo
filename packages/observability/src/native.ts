import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";
import type { Sink } from "./seam";
import { scrub } from "./pii";

/**
 * Where a crash on a seller's phone actually goes.
 *
 * `@sailo/observability` is the seam: every `captureError` in the app already
 * calls through it, and the sink behind it defaults to `console.error` — which
 * on a device means nobody ever sees it. This is the sink that changes that,
 * and it is the whole reason the seam was built vendor-neutral.
 *
 * **This requires a development build.** `@sentry/react-native` ships native
 * code, so Expo Go cannot load it — `npx expo run:ios` (or an EAS dev build)
 * is now the way to run this app. That cost buys the thing a JavaScript-only
 * reporter cannot have: a hard crash in native code, an out-of-memory kill, and
 * an ANR are all invisible to JS and are exactly the failures nobody can
 * reproduce from a bug report.
 */

/**
 * What the app is, so an event can be attributed to a build.
 *
 * `runtimeVersion` rather than `version`: two builds can share a marketing
 * version and run different JavaScript, because `expo-updates` ships bundles
 * over the air. The runtime version identifies the bundle a phone is actually
 * running, which is what a stack trace has to be read against.
 */
function release(): string {
  const config = Constants.expoConfig;
  const runtime =
    typeof config?.runtimeVersion === "string" ? config.runtimeVersion : config?.version;
  return `${config?.slug ?? "sailo"}@${runtime ?? "0.0.0"}`;
}


/**
 * Start Sentry and hand back a sink for `@sailo/observability`, or null when no
 * DSN is configured.
 *
 * Null rather than a no-op sink, so the caller keeps the console sink instead:
 * a reporter that silently discards is worse than an obviously-local one, and
 * local dev and CI both want the console.
 */
export function startSentry(dsn: string | undefined): Sink | null {
  if (!dsn) return null;

  Sentry.init({
    dsn,
    release: release(),
    environment: __DEV__ ? "development" : "production",
    /*
     * Off, and deliberately. Sentry's default PII includes the device name —
     * which on iOS is very often the owner's actual name — and the IP address.
     * Neither helps read a stack trace.
     */
    sendDefaultPii: false,
    /*
     * Sampled, because a trace per screen transition on a phone network is the
     * seller's data allowance, not ours. Errors are never sampled; this is the
     * performance side only.
     */
    tracesSampleRate: __DEV__ ? 0 : 0.1,
    /*
     * In development the red box is already the report, and shipping every
     * hot-reload error to a shared project makes the real ones unfindable.
     */
    enabled: !__DEV__,
  });

  return {
    captureError(error, context) {
      const err = error instanceof Error ? error : new Error(String(error));
      Sentry.captureException(err, {
        tags: {
          scope: context?.scope ?? "unknown",
          ...(context?.shopId ? { shop_id: context.shopId } : null),
        },
        extra: scrub(context?.extra),
      });
    },
    captureMessage(message, severity = "info", context) {
      Sentry.captureMessage(message, {
        level: severity === "warning" ? "warning" : severity,
        tags: {
          scope: context?.scope ?? "unknown",
          ...(context?.shopId ? { shop_id: context.shopId } : null),
        },
        extra: scrub(context?.extra),
      });
    },
  };
}
