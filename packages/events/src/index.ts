/*
 * The bus itself — publishing and subscribing. The SSE response half lives at
 * `@sailo/events/stream`, kept separate so a write path that only announces
 * doesn't pull the streaming layer in with it.
 */
export * from "./events";
