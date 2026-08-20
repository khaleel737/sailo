/**
 * One shape for every answer `/api/v1` gives, success or failure.
 *
 * Written down here rather than left to each route, because an API whose error
 * body varies by endpoint is one every consumer has to special-case — and the
 * consumers here are Zapier steps and language models, both of which handle
 * "the same envelope every time" far better than they handle prose.
 *
 * No `server-only`: the MCP tool layer reuses `ApiFailure` to turn a refusal
 * into something a model can read, and the docs page renders `API_ERROR_CODES`
 * as a table.
 */

/**
 * Machine-readable codes. Stable — a consumer branches on these, so one is
 * never renamed, only added to.
 */
export const API_ERROR_CODES = {
  /** No credential, or one we do not recognise. */
  unauthorized: 401,
  /** A real key, but not one allowed to do this. Scope, or plan. */
  forbidden: 403,
  not_found: 404,
  /** Malformed input — a bad cursor, an unparseable body, a missing field. */
  invalid_request: 400,
  rate_limited: 429,
  server_error: 500,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_CODES;

export type ApiFailure = { code: ApiErrorCode; message: string };

/**
 * The version string every response carries.
 *
 * A date, and it changes only when something already sent stops meaning what
 * it meant. Adding a field is not a version change — consumers are told so in
 * the docs, because the alternative is every additive improvement breaking
 * every integration built on the last one.
 */
export const API_VERSION = "2026-08-12";

function withHeaders(body: unknown, status: number, extra?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "sailo-version": API_VERSION,
      /*
       * Nothing here is ever cacheable by an intermediary. Every response is
       * scoped to one shop by a bearer token, and a shared cache that keyed on
       * the URL alone would serve one seller's orders to another.
       */
      "cache-control": "no-store, private",
      ...extra,
    },
  });
}

/** A single object. */
export function apiOk(data: unknown, extra?: HeadersInit): Response {
  return withHeaders({ data }, 200, extra);
}

/**
 * A page of objects.
 *
 * `hasMore` as well as `nextCursor` because they answer different questions,
 * and a consumer looping on "is the cursor null" gets the wrong answer on the
 * last full page of a keyset scan.
 */
export function apiList(
  data: readonly unknown[],
  page: { hasMore: boolean; nextCursor: string | null },
  extra?: HeadersInit,
): Response {
  return withHeaders({ data, has_more: page.hasMore, next_cursor: page.nextCursor }, 200, extra);
}

export function apiFail(failure: ApiFailure, extra?: HeadersInit): Response {
  return withHeaders(
    { error: { code: failure.code, message: failure.message } },
    API_ERROR_CODES[failure.code],
    extra,
  );
}

/* -------------------------------------------------------------------------- */
/*  Rate-limit headers                                                         */
/* -------------------------------------------------------------------------- */

/**
 * What a caller has left, on **every** answer rather than only on a refusal.
 *
 * A budget you only learn about by exhausting it is a budget that has already
 * cost you a rejected request. An integration that can read `ratelimit-remaining`
 * on a success can slow itself down before anything is refused, which is the
 * difference between a client that degrades and one that thrashes.
 *
 * The un-prefixed spelling is the one from the IETF's rate-limit-headers draft
 * rather than the older `X-RateLimit-*`. `X-` prefixes on new headers were
 * deprecated by RFC 6648 fifteen years ago, and there is no installed base here
 * to be compatible with — these headers have never been sent before.
 *
 * `retry-after` alongside them is not redundant: it is a real RFC 9110 header
 * that HTTP clients, proxies and libraries already understand without being
 * taught, and it is the one a generic retry helper will find.
 */
export function rateHeaders(rate: {
  limit: number;
  remaining: number;
  resetSeconds: number;
}): Record<string, string> {
  return {
    "ratelimit-limit": String(rate.limit),
    "ratelimit-remaining": String(rate.remaining),
    "ratelimit-reset": String(rate.resetSeconds),
  };
}

/** `retry-after`, in seconds, for a refusal that knows when to come back. */
export function retryAfterHeader(seconds: number): Record<string, string> {
  return { "retry-after": String(Math.max(1, Math.ceil(seconds))) };
}

/* -------------------------------------------------------------------------- */
/*  Paging                                                                     */
/* -------------------------------------------------------------------------- */

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/*
 * The cursor is `@sailo/core/paging` now — one implementation.
 *
 * This file held the strict decoder, the one that checks the id is uuid-shaped
 * because it is interpolated into a comparison against a `uuid` column and
 * Postgres raises on a malformed one. `@sailo/commerce/pagination` held a copy
 * that did not, and the phone's `orders.list` used the copy — so the same bad
 * cursor was a clean 400 here and a 500 there.
 *
 * Re-exported so `./handlers` and every route keep importing it from the module
 * that owns the API's envelope.
 */
export { decodeCursor, encodeCursor, type Cursor } from "@sailo/core/paging";

/** `?limit=`, clamped. A caller asking for a million gets a hundred. */
export function readLimit(url: URL): number {
  const raw = Number(url.searchParams.get("limit"));
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(raw), MAX_LIMIT);
}
