import "server-only";
import { apiGuard, type ApiCaller } from "./auth";
import type { Handled, ListOptions, Page } from "./handlers";
import { apiFail, apiList, apiOk, rateHeaders, readLimit } from "./respond";
import type { ApiScope } from "./keys";

/**
 * The five lines every `/api/v1` route would otherwise repeat.
 *
 * Written once so that a route body is the *question* and nothing else. The
 * shape it enforces matters more than the lines it saves: a handler is
 * unreachable until the guard has run, so there is no way to add an endpoint
 * that forgets to authenticate, forgets the scope, or forgets the plan gate.
 *
 * **No CORS headers anywhere, deliberately.** Every call here carries a bearer
 * token, and a token a browser can send is a token in somebody's JavaScript
 * bundle. Refusing cross-origin requests at the browser is the cheapest way to
 * make "call the Sailo API from my storefront" fail immediately and loudly,
 * rather than working right up until the key is scraped.
 */

/** A single resource. */
export async function handleOne<T>(
  request: Request,
  fn: (caller: ApiCaller) => Handled<T> | Promise<Handled<T>>,
  scope: ApiScope = "read",
): Promise<Response> {
  const guard = await apiGuard(request, scope);
  if (!guard.ok) return guard.response;

  const rate = rateHeaders(guard.caller.rate);

  try {
    const result = await fn(guard.caller);
    return result.ok ? apiOk(result.data, rate) : apiFail(result.failure, rate);
  } catch (error) {
    return serverError(error, request, rate);
  }
}

/** A page of resources, with `limit` and `cursor` already read off the URL. */
export async function handleList<T>(
  request: Request,
  fn: (
    caller: ApiCaller,
    options: ListOptions,
    url: URL,
  ) => Promise<Handled<T[]> & { page?: Page<unknown> }>,
): Promise<Response> {
  const guard = await apiGuard(request, "read");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const rate = rateHeaders(guard.caller.rate);

  try {
    const result = await fn(
      guard.caller,
      { limit: readLimit(url), cursor: url.searchParams.get("cursor") },
      url,
    );
    if (!result.ok) return apiFail(result.failure, rate);

    return apiList(
      result.data,
      {
        hasMore: result.page?.hasMore ?? false,
        nextCursor: result.page?.nextCursor ?? null,
      },
      rate,
    );
  } catch (error) {
    return serverError(error, request, rate);
  }
}

/**
 * Reads a JSON body, or hands back the refusal.
 *
 * The size cap is on the *declared* length as well as the parse, because a
 * body that never ends is not something `json()` protects against — and this
 * endpoint is authenticated, which means the caller has already got past the
 * cheapest defences.
 */
export async function readJson(
  request: Request,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > 64 * 1024) {
    return {
      ok: false,
      response: apiFail({ code: "invalid_request", message: "That body is too large." }),
    };
  }

  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        response: apiFail({ code: "invalid_request", message: "Send a JSON object." }),
      };
    }
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      response: apiFail({ code: "invalid_request", message: "That body is not valid JSON." }),
    };
  }
}

/**
 * The catch-all.
 *
 * Logs the real error and returns a sentence that says nothing about it. A
 * stack trace, a Postgres message or a constraint name in a response body is a
 * description of our schema handed to whoever provoked it.
 */
function serverError(error: unknown, request: Request, extra?: HeadersInit): Response {
  console.error(`[sailo] api error on ${new URL(request.url).pathname}`, error);
  return apiFail(
    {
      code: "server_error",
      message: "Something went wrong on our side. Try again.",
    },
    extra,
  );
}
