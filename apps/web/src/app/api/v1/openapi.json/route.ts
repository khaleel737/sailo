import { openApiDocument } from "@/lib/api/openapi";
import { API_VERSION } from "@/lib/api/respond";
import { APP_URL } from "@/lib/seo";

/**
 * `GET /api/v1/openapi.json` — the machine-readable description of this API.
 *
 * **Unauthenticated, unlike every other route under `/api/v1`.** It describes
 * the shape of the API and contains no shop's data, so a key would buy nothing
 * — and would cost the thing the document is for: somebody deciding whether
 * Sailo fits their stack needs to point Postman, an SDK generator or a model
 * at this *before* they have an account. A spec behind a credential is a spec
 * nobody evaluates.
 *
 * It is also the only file here a generator reads, which is why it is served
 * rather than committed: the `servers` entry has to name the deployment
 * answering the request, and a checked-in copy would name whichever one it was
 * generated on.
 */

/*
 * No `dynamic` or `revalidate` segment config, deliberately.
 *
 * Those are what the Cache Components migration removed from this app, and no
 * other route handler here carries them. The caching that matters for a file
 * like this happens at the edge anyway, off the `cache-control` header below —
 * and the work being cached is `JSON.stringify` over an object graph built from
 * constants, which is not worth a cache entry to reason about.
 */
export function GET(): Response {
  return new Response(JSON.stringify(openApiDocument(APP_URL), null, 2), {
    status: 200,
    headers: {
      /*
       * The media type registered for OpenAPI 3.1. `application/json` would
       * also be read by every tool, but this one lets a client that is
       * sniffing know what it found without parsing it first.
       */
      "content-type": "application/openapi+json; charset=utf-8",
      "sailo-version": API_VERSION,
      /*
       * Public, unlike the rest of `/api/v1` — there is no bearer token on
       * this route and no shop behind it, so a shared cache holding one copy
       * for everybody is correct rather than a leak.
       */
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      /* A generator running in a browser tab is a legitimate reader here. */
      "access-control-allow-origin": "*",
    },
  });
}
