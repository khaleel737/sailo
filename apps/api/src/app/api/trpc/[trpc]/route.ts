import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@sailo/api";
import { createContext } from "@/lib/context";

/**
 * The mobile app's data endpoint.
 *
 * This is the one place better-auth meets @sailo/api: it reads the bearer token
 * the app sent (the `bearer()` plugin looks in `Authorization`), resolves the
 * seller's shop, and hands @sailo/api nothing but a `shopId`. Every procedure
 * scopes to that id, so a token that resolves to no shop can read nothing.
 *
 * It used to live in apps/web. Nothing about the request changed in the move —
 * same path, same context, same router — but the app serving it now holds a
 * verify-only auth instance (`@/lib/auth`), so this route can recognise a
 * session and can no longer be the thing that grants one.
 */

/**
 * Which browsers may call this from another origin.
 *
 * Empty by default, and that is the correct default: the only client today is
 * the native app, and a native `fetch` is not subject to CORS at all — it
 * never sends an `Origin`, never sends a preflight, and ignores whatever we
 * answer here. So nothing this file does can break the mobile app, and
 * nothing it *omits* can lock it out.
 *
 * What the allowlist is for is the web clients that come next: apps/web
 * itself, once it calls the API app across a hostname boundary, and any
 * dashboard or preview deployment that does the same. Those are named
 * explicitly through the environment rather than reflected back from the
 * request, because a bearer token is a credential and an origin that can
 * choose its own permission is not an allowlist.
 *
 * `*` is deliberately not supported. It would let any page on the internet
 * read a seller's shop with a token it had got hold of, and it is also simply
 * invalid alongside credentials — browsers reject the pair.
 */
const ALLOWED_ORIGINS = new Set(
  (process.env.API_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

/**
 * The CORS headers for one request, or none.
 *
 * `Vary: Origin` goes out either way. Without it a CDN or a shared cache can
 * serve the allowed origin's response — headers included — to a caller whose
 * origin is not on the list, which is the allowlist leaking through the cache
 * rather than through the code.
 */
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return { Vary: "Origin" };
  return {
    Vary: "Origin",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Expose-Headers": "set-auth-token",
  };
}

async function handler(req: Request): Promise<Response> {
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createContext(req),
  });

  /*
   * tRPC builds the response, so the headers are added to a copy rather than
   * passed in — `fetchRequestHandler` has a `responseMeta` hook, but it only
   * sees the procedure results and not the request, and the origin check
   * needs the request.
   */
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(req))) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * The preflight. Answered for every origin, permissive only for the allowed
 * ones — an unlisted origin gets a 204 with no `Access-Control-Allow-Origin`,
 * which the browser reads as a refusal, and which tells a prober nothing it
 * could not already learn by asking.
 */
export function OPTIONS(req: Request): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(req),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      // `content-type` for the batched POST body, `authorization` for the
      // bearer token, `x-trpc-source` for the client's own header.
      "Access-Control-Allow-Headers": "Authorization, Content-Type, x-trpc-source",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export { handler as GET, handler as POST };
