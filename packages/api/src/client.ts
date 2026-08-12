import { createTRPCClient, httpBatchLink } from "@trpc/client";
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

export type { AppRouter };
