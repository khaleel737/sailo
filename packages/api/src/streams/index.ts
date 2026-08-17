/**
 * Server-sent event endpoints.
 *
 * Transport: they authenticate a subscriber and hand back a stream. What lives in
 * an app's route file is the mount and `maxDuration`, which is Next's.
 */

export * from "./partner-events";
