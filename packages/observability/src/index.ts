/**
 * Where an error goes, and the two places it can be sent from.
 *
 * `./seam` — re-exported here — is the vendor-neutral part: `captureError`,
 * `captureMessage`, and an `init` that swaps the sink. Every call site in every
 * app talks to that and nothing else, which is what lets the destination change
 * without a single one of them changing.
 *
 * The sinks are deliberately *not* re-exported from this barrel:
 *
 *   `@sailo/observability/web`     Sentry for a Next server (web and api)
 *   `@sailo/observability/native`  Sentry for the phone
 *
 * Each pulls a different, heavy, platform-specific SDK — `@sentry/node` cannot
 * be bundled by Metro and `@sentry/react-native` cannot run on a server. A
 * barrel that re-exported both would drag each into the other's build the
 * moment anything imported `captureError`, which is nearly every file in the
 * repo. So the seam stays free of both, and an app reaches for its own sink
 * once, at its own entry point.
 */

export * from "./seam";
