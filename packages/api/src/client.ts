import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "./router";

/**
 * The typed client the mobile app calls. It imports the router only as a type,
 * which the compiler erases — so nothing here drags @sailo/db or the server
 * runtime into the app bundle; the app ships the client, the server keeps the
 * queries. `headers` is a thunk so the bearer token can be read fresh on every
 * request rather than frozen at construction.
 */
export function createApiClient(opts: {
  url: string;
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
}) {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: opts.url, headers: opts.headers })],
  });
}

/**
 * What each procedure actually puts on the wire, and what it accepts.
 *
 * Not the same as the `@sailo/db` row types, and the difference is the whole
 * reason these exist. There is no transformer on this client, so the response
 * is plain JSON: every `timestamp` column that is a `Date` on the server
 * arrives as an ISO **string**. A screen typed off `Order` from
 * `@sailo/db/schema` would compile against `createdAt: Date`, call
 * `.getTime()` on it, and crash on a device against a string — a mismatch the
 * compiler cannot see because both types are called `Order`.
 *
 * Derived from the router, so they cannot drift from it: a procedure that
 * changes shape changes these in the same commit, and every screen reading
 * them stops compiling until it is updated.
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type RouterInputs = inferRouterInputs<AppRouter>;

export type { AppRouter };
