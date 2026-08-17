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
/*  Paging                                                                     */
/* -------------------------------------------------------------------------- */

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/**
 * A cursor is the sort key of the last row handed out, not an offset.
 *
 * Offsets are wrong for a feed that is being written to while it is read: a
 * new order arriving between page one and page two shifts every row down by
 * one, so the consumer sees one order twice and never sees another. A keyset
 * cursor names a position in the ordering rather than a distance from the
 * start, so concurrent writes cannot make it skip.
 *
 * Opaque on purpose — base64 of `<timestamp>|<id>`. Not encrypted, because it
 * encodes nothing the holder does not already have; opaque only so nobody
 * builds an integration on its internals and is broken when the ordering
 * changes.
 */
export type Cursor = { createdAt: Date; id: string };

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, "utf8").toString(
    "base64url",
  );
}

export function decodeCursor(raw: string | null): Cursor | null | "invalid" {
  if (!raw) return null;

  try {
    const [timestamp, id] = Buffer.from(raw, "base64url").toString("utf8").split("|", 2);
    if (!timestamp || !id) return "invalid";

    const createdAt = new Date(timestamp);
    if (Number.isNaN(createdAt.getTime())) return "invalid";

    /*
     * The id half is checked for shape as well. It is interpolated into a
     * comparison against a uuid column, and a value that is not a uuid makes
     * Postgres raise rather than return nothing — a 500 where a 400 is the
     * honest answer.
     */
    if (!/^[0-9a-f-]{36}$/i.test(id)) return "invalid";

    return { createdAt, id };
  } catch {
    return "invalid";
  }
}

/** `?limit=`, clamped. A caller asking for a million gets a hundred. */
export function readLimit(url: URL): number {
  const raw = Number(url.searchParams.get("limit"));
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(raw), MAX_LIMIT);
}
