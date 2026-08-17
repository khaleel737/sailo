import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The API app's own end-to-end layer: every route driven through its real
 * handler, over real `Request` objects.
 *
 * WHY THIS EXISTS
 *
 * This app had two unit tests — the health route and `createContext` — and no
 * test that had ever sent it a request. Everything a client actually
 * experiences was uncovered: whether an unauthenticated call is refused before
 * anything expensive runs, whether the CORS allowlist can be talked out of
 * itself, whether a preflight answers at all.
 *
 * `apps/web` has two end-to-end layers already — Playwright in `e2e/*.spec.ts`
 * for a browser, and the scenario suite in `e2e/scenarios` against a real
 * database — and `apps/mobile` drives its screens through
 * `@testing-library/react-native`. This is the equivalent for the app whose
 * entire surface is HTTP.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not reach the database. A route's job here is to decide *who is
 * asking* and to refuse if the answer is nobody, and that decision happens
 * before any query — which is exactly why it can be tested without one. What a
 * procedure then does with a valid `shopId` is covered where that logic lives,
 * in `@sailo/api` and the domain packages.
 *
 * Named `.e2e.ts` rather than `.test.ts` so `vitest.config.mts` keeps unit runs
 * fast and this suite is asked for explicitly — `pnpm test:e2e`.
 */

/*
 * Every test states its own allowlist, including the ones about an *unlisted*
 * origin.
 *
 * The route reads `API_ALLOWED_ORIGINS` once at module load and builds a Set, so
 * `vi.resetModules()` before each test is what makes a stubbed value take
 * effect. Leaving the empty case to whatever the ambient environment happens to
 * hold made this suite pass alone and fail in a full run — a test that depends on
 * a variable being absent is a test that passes for a reason it does not state.
 */
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("API_ALLOWED_ORIGINS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * A query, as tRPC's fetch adapter expects one: GET with the input in the query
 * string.
 *
 * The first draft of this sent a POST and asserted "any 4xx". It passed — with a
 * 405 `METHOD_NOT_SUPPORTED`, because `shop.get` is a query and POST is for
 * mutations. A test that cannot tell "we refused you" from "you used the wrong
 * verb" is not testing authorisation, so this asserts the code as well as the
 * status.
 */
const query = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://api.sailo.store/api/trpc/${path}?input=%7B%7D`, { headers });

describe("the tRPC endpoint", () => {
  /*
   * The one thing every client depends on and no unit test covers: a request
   * with no bearer token must not reach a procedure. `createContext` resolves
   * `shopId` to undefined and `shopProcedure` refuses — so the assertion is
   * that the status is a refusal, not that a query returned nothing.
   */
  it("refuses an unauthenticated call rather than answering it", async () => {
    const { GET } = await import("@/app/api/trpc/[trpc]/route");
    const response = await GET(query("shop.get"));

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: { data?: { code?: string } } };
    expect(body.error?.data?.code).toBe("UNAUTHORIZED");
  });

  /*
   * The same for a mutation, and it is a different code path: `shopProcedure`
   * refuses both, but a mutation reaches the router through POST with a JSON
   * body, and a route that authenticated only on the read side would pass the
   * test above.
   */
  it("refuses an unauthenticated mutation too", async () => {
    const { POST } = await import("@/app/api/trpc/[trpc]/route");
    const response = await POST(
      new Request("https://api.sailo.store/api/trpc/products.save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(401);
  });

  /*
   * `Vary: Origin` on every answer, allowed or not.
   *
   * Without it a CDN or any shared cache can serve the allowed origin's
   * response — `Access-Control-Allow-Origin` included — to a caller whose
   * origin is not on the list. That is the allowlist leaking through the cache
   * rather than through the code, and it is invisible to a test that only
   * checks the happy path.
   */
  it("varies on origin even when it allows nothing", async () => {
    const { OPTIONS } = await import("@/app/api/trpc/[trpc]/route");
    const response = OPTIONS(
      new Request("https://api.sailo.store/api/trpc", {
        method: "OPTIONS",
        headers: { origin: "https://evil.example" },
      }),
    );

    expect(response.headers.get("vary")).toBe("Origin");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  /*
   * An unlisted origin gets a 204 with no allow header, which a browser reads
   * as a refusal. Answering the preflight rather than erroring is deliberate:
   * it tells a prober nothing it could not learn by asking.
   */
  it("answers a preflight for an unlisted origin without permitting it", async () => {
    const { OPTIONS } = await import("@/app/api/trpc/[trpc]/route");
    const response = OPTIONS(
      new Request("https://api.sailo.store/api/trpc", {
        method: "OPTIONS",
        headers: { origin: "https://evil.example" },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("permits an origin that is on the list, with credentials", async () => {
    vi.stubEnv("API_ALLOWED_ORIGINS", "https://sailo.store,https://admin.sailo.store");
    const { OPTIONS } = await import("@/app/api/trpc/[trpc]/route");
    const response = OPTIONS(
      new Request("https://api.sailo.store/api/trpc", {
        method: "OPTIONS",
        headers: { origin: "https://admin.sailo.store" },
      }),
    );

    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://admin.sailo.store",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  /*
   * `*` must never appear. It would let any page on the internet read a
   * seller's shop with a token it had got hold of, and it is invalid alongside
   * credentials anyway — browsers reject the pair, which means the failure
   * would look like "CORS is broken" rather than "we published a hole".
   */
  it("never answers with a wildcard, even if one is configured", async () => {
    vi.stubEnv("API_ALLOWED_ORIGINS", "*");
    const { OPTIONS } = await import("@/app/api/trpc/[trpc]/route");
    const response = OPTIONS(
      new Request("https://api.sailo.store/api/trpc", {
        method: "OPTIONS",
        headers: { origin: "https://anything.example" },
      }),
    );

    expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("the upload endpoint", () => {
  /*
   * 401 before the body is read.
   *
   * This is the largest write the app accepts and the request size is the
   * caller's choice, so "is this a seller" has to be settled before anything
   * touches `formData()`. A route that authenticated *after* parsing would pass
   * a happy-path test and let a stranger spend a hundred megabytes of our
   * bandwidth to be told no.
   */
  it("refuses an unauthenticated upload", async () => {
    const { POST } = await import("@/app/api/upload/route");
    const response = await POST(
      new Request("https://api.sailo.store/api/upload", { method: "POST" }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
  });
});

describe("the health endpoint", () => {
  it("answers without a token, because a probe has none", async () => {
    const { GET } = await import("@/app/health/route");
    const response = await GET();

    expect(response.status).toBe(200);
  });
});

/* -------------------------------------------------------------------------- */
/*  The endpoints that answer on two origins                                   */
/* -------------------------------------------------------------------------- */

/**
 * MCP and the Resend webhook are mounted here *and* on apps/web, because a
 * published URL cannot move without a window where it answers nowhere. Both were
 * a full copy of their handler until it moved into `@sailo/api`, and these drive
 * the mount that is left — a route file that forgets an export, or a barrel that
 * stops resolving, builds cleanly and fails on the first real request.
 *
 * Every case below is decided before any query runs, which is why this suite can
 * assert them without a database.
 */
describe("the MCP endpoint", () => {
  /*
   * The current revision has no GET stream and no session to delete. Answering
   * 405 with an `allow` header is what lets an older client fall back instead of
   * hanging on a stream that will never open.
   */
  it("refuses a GET, and says what it accepts", async () => {
    const { GET } = await import("@/app/api/mcp/route");
    const response = await GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("refuses a DELETE the same way, because there is no session to delete", async () => {
    const { DELETE } = await import("@/app/api/mcp/route");

    expect((await DELETE()).status).toBe(405);
  });

  /*
   * The DNS-rebinding defence, and the specification makes it a MUST. A page on
   * the open web can make a browser POST here; it cannot read the response, but a
   * request that *executes* is already too far when the tools include writes.
   *
   * This has to be checked before the body is parsed, so the assertion is on a
   * request whose body would also fail — 403 proves the order.
   */
  it("refuses a browser origin that is not this deployment, before parsing anything", async () => {
    const { POST } = await import("@/app/api/mcp/route");
    const response = await POST(
      new Request("https://api.sailo.store/api/mcp", {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "application/json" },
        body: "not json at all",
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("Origin not allowed");
  });

  /*
   * No Origin header is the normal case — MCP clients are not browsers — so an
   * absent one must not be treated as a foreign one.
   */
  it("answers a malformed body with a JSON-RPC parse error, not a crash", async () => {
    const { POST } = await import("@/app/api/mcp/route");
    const response = await POST(
      new Request("https://api.sailo.store/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: { code?: number } };
    // -32700 is JSON-RPC's parse error; a bare 400 would not tell a client why.
    expect(body.error?.code).toBe(-32_700);
  });

  /*
   * A notification carries no id and expects no result. A server that replied to
   * one with a JSON-RPC result would be answering something that is not a
   * request, which is the bug this endpoint's own header calls out.
   */
  it("accepts a notification with 202 and an empty body", async () => {
    const { POST } = await import("@/app/api/mcp/route");
    const response = await POST(
      new Request("https://api.sailo.store/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      }),
    );

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });
});

describe("the Resend webhook", () => {
  /*
   * It authenticates from a Svix signature over the raw body and from nothing
   * else — no session, no cookie — which is what makes it safe to mount twice.
   * An unsigned POST must be refused, and refused rather than 500'd: a handler
   * that throws on a missing header is one Resend will retry forever.
   */
  const unsigned = () =>
    new Request("https://api.sailo.store/api/resend/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "email.bounced", data: {} }),
    });

  it("refuses a POST that carries no signature", async () => {
    /*
     * The secret is stubbed, and that is the point. The first draft of this test
     * left it absent, got a 500 from the misconfiguration branch below, and would
     * have reported "refuses unsigned requests" while never reaching the code that
     * does — the same mistake this file's header records about `API_ALLOWED_ORIGINS`.
     */
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_test");
    const { POST } = await import("@/app/api/resend/webhook/route");
    const response = await POST(unsigned());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "unsigned" });
  });

  /*
   * Fail closed, deliberately: an absent secret on an endpoint that writes reads
   * as "no", never as "yes to everyone". 500 is also the right code for Resend to
   * see — it retries, so a deploy that forgot the variable loses nothing once the
   * variable arrives.
   */
  it("refuses everything when the secret is not configured at all", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    const { POST } = await import("@/app/api/resend/webhook/route");
    const response = await POST(unsigned());

    expect(response.status).toBe(500);
    expect(await response.text()).toContain("RESEND_WEBHOOK_SECRET");
  });
});

