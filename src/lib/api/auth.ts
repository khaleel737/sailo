import "server-only";
import type { Shop } from "@/db/schema";
import { can, cheapestPlanWith } from "@/lib/plans";
import { rateLimit, refundRateLimit } from "@/lib/redis";
import { callerIp } from "@/lib/client-ip";
import { resolveApiKey, touchApiKey, type ApiScope } from "./keys";
import { apiFail, type ApiFailure } from "./respond";

/**
 * Turning a bearer token into a shop, or into a refusal.
 *
 * Shared by `/api/v1` and `/api/mcp`, because they are one credential and one
 * set of rules — a second copy of this for the MCP endpoint would be a second
 * place for the plan gate or the scope check to be forgotten, and the one that
 * forgot would be the way in.
 *
 * Returns a value rather than throwing. The two callers render a failure very
 * differently — an HTTP body with a code for REST, a JSON-RPC error for MCP —
 * and a thrown exception would force both to catch and re-shape it.
 */

export type ApiCaller = {
  shop: Shop;
  keyId: string;
  scopes: readonly string[];
};

export type AuthOutcome =
  | { ok: true; caller: ApiCaller }
  | { ok: false; failure: ApiFailure };

/**
 * Requests per minute per key.
 *
 * Per key rather than per address, deliberately: an integration and a seller's
 * browser routinely share an office IP, and a Zap running flat out must not be
 * able to throttle its owner out of their own admin. High enough that no
 * ordinary integration will ever see it, low enough that a runaway loop stops
 * being our database's problem within a minute.
 */
const PER_KEY_PER_MINUTE = 240;

/**
 * Failed authentications per address per minute.
 *
 * This is the budget for *guessing*, and the repo's rule is that such a budget
 * charges misses rather than lookups — so a successful call refunds its unit
 * below. Without the refund a legitimate integration polling every second
 * would exhaust its own anti-guessing allowance and lock itself out.
 */
const AUTH_ATTEMPTS_PER_MINUTE = 30;
const AUTH_WINDOW = 60;

/**
 * The credential, taken only from `Authorization: Bearer`.
 *
 * Not from a query string, and that is worth stating: a token in a URL is
 * written to every access log, proxy log and browser history it passes
 * through, and turns a link somebody pastes into a support ticket into a
 * working credential. Some tools make it tempting to allow; none of them need
 * it badly enough.
 */
function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

export async function authenticateApi(request: Request): Promise<AuthOutcome> {
  const token = bearerToken(request);
  if (!token) {
    return {
      ok: false,
      failure: {
        code: "unauthorized",
        message: "Send your key as `Authorization: Bearer sailo_sk_…`.",
      },
    };
  }

  /*
   * Charged before the lookup, refunded after a success.
   *
   * The inviting alternative — check the token, then charge only if it was
   * wrong — has a hole exactly where this limit is aimed: every request in a
   * concurrent burst reads the counter before any of them has written to it,
   * so a thousand guesses fired at once all pass a ceiling of thirty. `INCR`
   * is atomic and the verdict comes from its return value, which is why the
   * charge has to come first.
   */
  const ip = await callerIp();
  const budget = await rateLimit(`api-auth:${ip}`, AUTH_ATTEMPTS_PER_MINUTE, AUTH_WINDOW);
  if (!budget.allowed) {
    return {
      ok: false,
      failure: {
        code: "rate_limited",
        message: "Too many failed key attempts from this address. Wait a minute.",
      },
    };
  }

  const resolved = await resolveApiKey(token);
  if (!resolved) {
    return {
      ok: false,
      failure: { code: "unauthorized", message: "That key is not valid." },
    };
  }

  await refundRateLimit(`api-auth:${ip}`, AUTH_WINDOW);

  const { key, shop } = resolved;

  /*
   * The plan gate, checked on every request rather than only when the key was
   * minted. A seller who downgrades stops being able to use a key they already
   * hold — which is the point of a gate, and would not be true of a check that
   * ran once at creation.
   */
  if (!can(shop, "integrations")) {
    const plan = cheapestPlanWith("integrations");
    return {
      ok: false,
      failure: {
        code: "forbidden",
        message: `The API is available on ${plan?.name ?? "a paid plan"}.`,
      },
    };
  }

  /*
   * A shop that has been deleted keeps its rows for the retention window, and
   * every one of them is readable through a key the departed seller still
   * holds. Refused here rather than in each route.
   */
  if (shop.deletedAt) {
    return {
      ok: false,
      failure: { code: "unauthorized", message: "That key is not valid." },
    };
  }

  const perKey = await rateLimit(`api:${key.id}`, PER_KEY_PER_MINUTE, 60);
  if (!perKey.allowed) {
    return {
      ok: false,
      failure: {
        code: "rate_limited",
        message: `This key is limited to ${PER_KEY_PER_MINUTE} requests a minute.`,
      },
    };
  }

  // Bookkeeping, throttled to once an hour inside. Never awaited into a
  // position where its failure could matter.
  void touchApiKey(key.id);

  return { ok: true, caller: { shop, keyId: key.id, scopes: key.scopes } };
}

/**
 * Whether this caller may change something.
 *
 * A separate step from authentication because the answer differs per route,
 * and because a read-only key reaching a write endpoint should be told exactly
 * that — "this key is read-only" is actionable, and a bare 403 is not.
 */
export function requireScope(caller: ApiCaller, scope: ApiScope): ApiFailure | null {
  if (caller.scopes.includes(scope)) return null;
  return {
    code: "forbidden",
    message:
      scope === "write"
        ? "This key is read-only. Create a key with write access to do that."
        : `This key does not carry the \`${scope}\` scope.`,
  };
}

/**
 * The whole preamble for a REST route, as one call.
 *
 * Hands back either the caller or a finished `Response`, so a route body is
 * `if (!auth.ok) return auth.response;` and then the actual work — which is
 * the shape that makes it hard to write a route that forgets to check.
 */
export async function apiGuard(
  request: Request,
  scope: ApiScope = "read",
): Promise<{ ok: true; caller: ApiCaller } | { ok: false; response: Response }> {
  const auth = await authenticateApi(request);
  if (!auth.ok) return { ok: false, response: apiFail(auth.failure) };

  const denied = requireScope(auth.caller, scope);
  if (denied) return { ok: false, response: apiFail(denied) };

  return { ok: true, caller: auth.caller };
}
