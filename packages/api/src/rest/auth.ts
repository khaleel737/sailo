import "server-only";
import type { Shop } from "@sailo/db/schema";
import { can, cheapestPlanWith } from "@sailo/core/plans";
import { rateLimit, refundRateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";
import { resolveApiKey, touchApiKey, type ApiScope } from "./keys";
import { apiFail, rateHeaders, retryAfterHeader, type ApiFailure } from "./respond";

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
  /** What this key has left this minute. Rendered as headers on every answer. */
  rate: RateSnapshot;
};

/**
 * The budget, as a caller needs to see it.
 *
 * Carried on every response rather than only on a refusal, because the whole
 * point is to let a client slow down *before* it is refused. An integration
 * that only learns about the ceiling by hitting it has already had a request
 * rejected, and rejected requests are the ones that turn into retries, backlogs
 * and support tickets.
 */
export type RateSnapshot = {
  limit: number;
  remaining: number;
  /** Whole seconds until the window rolls and the budget is whole again. */
  resetSeconds: number;
};

export type AuthOutcome =
  | { ok: true; caller: ApiCaller }
  | {
      ok: false;
      failure: ApiFailure;
      /** Full `ratelimit-*` headers. Only ever the per-key budget. */
      rate?: RateSnapshot;
      /**
       * `retry-after` alone, with no budget attached.
       *
       * The guessing budget uses this. Its ceiling is deliberately unpublished
       * — telling somebody probing for keys exactly how many guesses they have
       * left is telling them how to pace the next attempt — but *when to come
       * back* gives nothing away, and a legitimate client that has tripped it
       * still deserves an answer it can act on.
       */
      retryAfterSeconds?: number;
    };

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
 * The anti-guessing budget, per address.
 *
 * Charged before the key is looked up and refunded after a success, so for
 * *sequential* traffic the counter hovers near zero however fast a valid client
 * polls. What it actually bounds, therefore, is not attempts per minute but
 * **authentications in flight at once** — refunds have not landed yet for
 * anything still being looked up.
 *
 * That is why the number is 240 and not the 30 it was. Thirty was chosen as a
 * rate and behaved as a concurrency ceiling, and the two are wildly different
 * once a client goes parallel: measured against this server, forty concurrent
 * requests carrying a **valid** key had ten of them refused with "too many
 * failed key attempts" — a sentence that was false in both halves. Since the
 * per-key limit invites 240 requests a minute, and no client reaches that
 * without overlapping them, the old ceiling made the documented allowance
 * unusable and blamed the caller for it.
 *
 * Raising it costs little of what the budget is really for. A `sailo_sk_` token
 * is 256 bits of `randomBytes`, so nothing here is being *guessed* at any rate;
 * the budget exists to stop an address flooding `resolveApiKey` with lookups,
 * and four a second sustained from one address is still a floor on that.
 */
const AUTH_ATTEMPTS_PER_MINUTE = 240;
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
  /*
   * DECISION B — fails closed (secret guessing).
   *
   * An API key is a bearer token for a whole shop's data and writes, and this
   * budget is the entire cost of guessing one. Failing open turns a cache outage
   * into an unmetered offline attack conducted online.
   *
   * The message is the same either way and deliberately says nothing about the
   * key: "wait a minute" is true when the budget is spent and true when there
   * was no budget to spend, and neither reveals whether the token was close.
   */
  const budget = await rateLimit(`api-auth:${ip}`, AUTH_ATTEMPTS_PER_MINUTE, AUTH_WINDOW, {
    onOutage: "closed",
  });
  if (!budget.allowed) {
    return {
      ok: false,
      failure: {
        code: "rate_limited",
        /*
         * Deliberately says nothing about the key. This budget is spent by
         * failures *and* by requests still in flight, so naming either would
         * be a guess — and telling somebody probing for keys which of the two
         * they hit is telling them whether they were close.
         */
        message: "Too many authentication attempts from this address. Slow down.",
      },
      retryAfterSeconds: budget.resetSeconds,
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
   * The entitlement gate, checked on every request rather than only when the
   * key was minted — so a change of plan takes effect on the next call rather
   * than needing the key reissued.
   *
   * The API is no longer sold by subscription: `integrations` now settles on
   * every plan, so no current tier is refused here. The check stays regardless,
   * as the one place that would enforce it again the day a plan turns the flag
   * off — a gate is cheaper to keep than to reinstate after a leak. What a plan
   * still changes is the *features* a key can reach: each carries its own
   * entitlement downstream (`/coupons`, `/flows`), so a working key is not a
   * key that can do everything.
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
  const rate: RateSnapshot = {
    limit: PER_KEY_PER_MINUTE,
    remaining: perKey.remaining,
    resetSeconds: perKey.resetSeconds,
  };

  if (!perKey.allowed) {
    return {
      ok: false,
      failure: {
        code: "rate_limited",
        message: `This key is limited to ${PER_KEY_PER_MINUTE} requests a minute. Retry in ${perKey.resetSeconds}s.`,
      },
      /*
       * Carried so the 429 can say *when*, not merely *no*.
       *
       * This used to be documented as a deliberate absence — the window is a
       * minute, so a client backing off a minute always clears. True, and
       * needlessly expensive: a caller refused at the fifty-ninth second of a
       * window waits a full minute for a budget that was whole again one second
       * later. Sixty times longer than it had to, on the exact path where
       * throughput already matters.
       */
      rate,
    };
  }

  // Bookkeeping, throttled to once an hour inside. Never awaited into a
  // position where its failure could matter.
  void touchApiKey(key.id);

  return { ok: true, caller: { shop, keyId: key.id, scopes: key.scopes, rate } };
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
  if (!auth.ok) {
    /*
     * A refusal says what it knows about the budget and nothing more. The
     * per-key path knows the whole thing; the guessing path knows only when to
     * come back, on purpose.
     */
    const headers = {
      ...(auth.rate ? rateHeaders(auth.rate) : {}),
      ...(auth.rate && auth.failure.code === "rate_limited"
        ? retryAfterHeader(auth.rate.resetSeconds)
        : {}),
      ...(auth.retryAfterSeconds ? retryAfterHeader(auth.retryAfterSeconds) : {}),
    };
    return { ok: false, response: apiFail(auth.failure, headers) };
  }

  const denied = requireScope(auth.caller, scope);
  if (denied) {
    // Authenticated, so the budget is known and was spent on this call.
    return { ok: false, response: apiFail(denied, rateHeaders(auth.caller.rate)) };
  }

  return { ok: true, caller: auth.caller };
}
