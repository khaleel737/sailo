/**
 * What describing an endpoint requires.
 *
 * The types and the shared pieces every entry reuses — an id parameter, the error set a
 * single-resource read can produce, the bearer header. Their own file because three
 * separate things read them (the docs page, the OpenAPI document, and the test that walks
 * the route tree), and a type imported from the 661-line module that also held the
 * catalogue meant each of them pulled the catalogue in behind it.
 */

import { DEFAULT_LIMIT, MAX_LIMIT, type ApiErrorCode } from "./respond";
import type { ApiScope } from "./keys";

/* -------------------------------------------------------------------------- */
/*  Shape                                                                      */
/* -------------------------------------------------------------------------- */

export type EndpointParam = {
  name: string;
  in: "path" | "query";
  required: boolean;
  /** JSON Schema, used verbatim by the OpenAPI document. */
  schema: Record<string, unknown>;
  description: string;
};

export type BodyField = {
  name: string;
  required: boolean;
  schema: Record<string, unknown>;
  description: string;
};

export type EndpointError = { code: ApiErrorCode; when: string };

/** The `components/schemas` name a response carries. */
export type ResourceName = "Shop" | "Order" | "Product" | "Contact";

export type Endpoint = {
  /** Stable anchor and OpenAPI `operationId`. Never renamed — docs deep-link to it. */
  id: string;
  method: "GET" | "POST";
  /** Path beneath `/api/v1`, with OpenAPI-style `{id}` placeholders. */
  path: string;
  /** The scope a key needs. `write` implies the key also carries `read`. */
  scope: ApiScope;
  /** One line, for the index table. */
  summary: string;
  /** The paragraph on the endpoint's own entry. */
  description: string;
  params: readonly EndpointParam[];
  body?: { fields: readonly BodyField[]; example: string };
  result: { resource: ResourceName; shape: "one" | "page" };
  /** Fields this endpoint adds on top of the bare resource. */
  resultExtra?: readonly BodyField[];
  errors: readonly EndpointError[];
  curl: (base: string) => string;
  /** A real response body, trimmed with `…` where a full one would not be read. */
  successExample: string;
};

/* -------------------------------------------------------------------------- */
/*  Shared pieces                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The refusals every authenticated route can produce, in the order a caller
 * meets them: no key, a key the plan or the scope does not allow, too many
 * calls, and our own fault.
 *
 * Listed on every endpoint rather than mentioned once at the top, because the
 * thing consuming this is often a generator or a model reading one operation
 * in isolation — and "see the introduction" is not something either can act on.
 */
export const COMMON_ERRORS: readonly EndpointError[] = [
  { code: "unauthorized", when: "No `Authorization` header, or a key we do not recognise." },
  {
    code: "forbidden",
    when: "A real key, but the shop's plan does not include the API.",
  },
  { code: "rate_limited", when: "Too many calls on this key. Slow down and retry." },
  { code: "server_error", when: "Our fault. The body says nothing about the cause; retry." },
] as const;

export const WRITE_ERROR: EndpointError = {
  code: "forbidden",
  when: "The key is read-only. Mint one with write access.",
};

/**
 * The request-body ceiling, from `readJson` in `./route.ts`.
 *
 * Stated here rather than imported because the literal lives inside that
 * function, and exporting it would mean editing a module that is being moved
 * out into its own package by another change in flight. `endpoints.test.ts`
 * reads that file and fails if the two ever disagree, so the number is pinned
 * even though it is not shared.
 */
export const MAX_BODY_KB = 64;

export const BAD_BODY: EndpointError = {
  code: "invalid_request",
  when: `The body is not a JSON object, or is over ${MAX_BODY_KB} KB.`,
};

export const LIMIT_PARAM: EndpointParam = {
  name: "limit",
  in: "query",
  required: false,
  schema: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
  description: `How many to return. Defaults to ${DEFAULT_LIMIT}, capped at ${MAX_LIMIT} — asking for more is clamped, not refused.`,
};

export const CURSOR_PARAM: EndpointParam = {
  name: "cursor",
  in: "query",
  required: false,
  schema: { type: "string" },
  description:
    "The `next_cursor` from the previous page. Omit for the first page. A cursor we did not issue is a 400, not an empty page.",
};

export const ID_PARAM = (what: string): EndpointParam => ({
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
  description: `The ${what} id.`,
});

export const PAGE_ERRORS: readonly EndpointError[] = [
  { code: "invalid_request", when: "`cursor` is not one we issued." },
  ...COMMON_ERRORS,
] as const;

export const ONE_ERRORS = (what: string): readonly EndpointError[] =>
  [
    { code: "not_found" as const, when: `No ${what} with that id in this shop.` },
    ...COMMON_ERRORS,
  ] as const;

/** `Authorization: Bearer …` on every call, and the reason it is never elsewhere. */
export const AUTH_HEADER = "Authorization: Bearer sailo_sk_…";

/* -------------------------------------------------------------------------- */
/*  Lookups                                                                    */
/* -------------------------------------------------------------------------- */

/** `GET /orders/{id}` — the form both the docs anchors and the drift test key on. */
export function endpointKey(endpoint: Pick<Endpoint, "method" | "path">): string {
  return `${endpoint.method} ${endpoint.path}`;
}
