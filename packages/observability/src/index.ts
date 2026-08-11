/**
 * The one thing worth taking whole from next-forge: a place for errors to go.
 *
 * Today Sailo's errors are `console.error` and nothing more — a web exception
 * is a line in a Vercel log, and a native crash on a seller's phone is
 * invisible. That is the gap this package exists to close. It is a thin,
 * vendor-neutral seam, not a vendor: the app calls `captureError` /
 * `captureMessage`, and the seam decides where they land.
 *
 * The default implementation logs, so nothing depends on a vendor being wired
 * before the monorepo is useful. When a Sentry DSN (or another sink) is
 * available, `init` swaps the sink in once at startup — in the web app's
 * `instrumentation.ts` and in the mobile app's root — and every existing
 * `captureError` call starts reporting without changing.
 *
 * Kept free of `next/*`, `react`, and any DOM API on purpose, so the exact
 * same package is importable from a Next server, a Next client, and a React
 * Native bundle.
 */

export type Severity = "fatal" | "error" | "warning" | "info";

export type ErrorContext = {
  /** Where it happened: "checkout", "cron:lifecycle", "mobile:cart". */
  scope?: string;
  /** Whose it was, when known — never PII, just an id for correlation. */
  userId?: string;
  shopId?: string;
  /** Anything else worth attaching; kept small and non-sensitive. */
  extra?: Record<string, unknown>;
};

export type Sink = {
  captureError: (error: unknown, context?: ErrorContext) => void;
  captureMessage: (
    message: string,
    severity?: Severity,
    context?: ErrorContext,
  ) => void;
};

/** The fallback sink: structured console output, so nothing is ever swallowed. */
const consoleSink: Sink = {
  captureError(error, context) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(
      `[sailo${context?.scope ? `:${context.scope}` : ""}]`,
      err.message,
      { ...context, stack: err.stack },
    );
  },
  captureMessage(message, severity = "info", context) {
    const line = `[sailo${context?.scope ? `:${context.scope}` : ""}] ${message}`;
    if (severity === "error" || severity === "fatal") console.error(line, context);
    else if (severity === "warning") console.warn(line, context);
    else console.info(line, context);
  },
};

let sink: Sink = consoleSink;

/**
 * Point observability at a real backend. Called once, at each app's entry
 * (web `instrumentation.ts`, mobile root). Passing nothing keeps the console
 * sink — which is what CI, previews and local dev want.
 */
export function init(next?: Partial<Sink>): void {
  sink = { ...consoleSink, ...next };
}

export function captureError(error: unknown, context?: ErrorContext): void {
  sink.captureError(error, context);
}

export function captureMessage(
  message: string,
  severity?: Severity,
  context?: ErrorContext,
): void {
  sink.captureMessage(message, severity, context);
}
