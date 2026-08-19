/**
 * The licence API — three endpoints a seller's *software* calls, spec 48.
 *
 * DELIBERATELY OUTSIDE `/api/v1`
 *
 * Everything on the authenticated surface is reached with a seller's API key.
 * That is exactly the wrong credential here: requiring it would put the key
 * that can read the whole shop's orders inside every customer's binary, where
 * it can be pulled out with a hex editor. The licence key *is* the credential,
 * and it authorises one thing — asking about itself.
 *
 * WHICH MAKES THIS THE MOST EXPOSED SURFACE IN THE PRODUCT
 *
 * No credential to check means anyone can call it, so what stops it becoming a
 * key-enumeration service is entirely what it refuses to say and how fast it
 * will say it:
 *
 *   * **The unknown-key answer and the disabled-key answer are the same
 *     bytes.** `{ "valid": false }`, no reason, no shape difference. Any
 *     distinguishable pair is an oracle for which keys a seller has issued.
 *   * **A reason comes back only to a caller holding a live key.** By then
 *     they have proved they hold it and there is nothing left to leak — and
 *     "you are over your activation limit" is the one refusal a paying
 *     customer has to be able to read.
 *   * **The ceiling charges misses, not lookups** (the coupon-enumeration
 *     rule). Software that validates on every launch spends nothing; something
 *     walking the keyspace pays for every step.
 *   * **Keyed on the key, not the address.** Desktop software behind one
 *     office NAT is fifty machines, and an address ceiling would lock out a
 *     whole customer while barely inconveniencing a guesser on a VPS.
 *   * **Decision B: fails closed.** This answers whether something exists, so
 *     an unmetered hour is an offline attack made online. `verdict.reason` is
 *     read: a fail-closed refusal is *not* an answer about the licence, and
 *     the body says so.
 */

import {
  activateLicense,
  deactivateLicense,
  validateLicense,
  type LicenseResult,
} from "@sailo/commerce/orders/server";
import { licenseKeyPrefix, normalizeLicenseKey } from "@sailo/core/codes";
import { rateLimit, refundRateLimit } from "@sailo/rate-limit";

/**
 * Attempts per key per window, and the window.
 *
 * Sixty in five minutes is far more than software polling on launch will ever
 * use and far less than a guessing run needs to be worth mounting — and since
 * only misses are charged, legitimate software never approaches it at all.
 */
const LICENSE_LIMIT = 60;
const LICENSE_WINDOW_SECONDS = 300;

/**
 * The refusal every unknown and every disabled key gets, byte for byte.
 *
 * A constant rather than a value built per call, because the property being
 * protected is that two code paths produce the *same bytes* — and the way that
 * property dies is somebody adding a field to one of them.
 */
const REFUSED = { valid: false } as const;

/**
 * Throttled, which is *unknown* rather than a negative answer.
 *
 * A caller told `{ valid: false }` because Redis was unreachable would
 * deactivate a paying customer's software. `retryable` is the flag that says
 * "ask again", and the HTTP status is 429 rather than 200 so a client that
 * reads neither still does not treat it as a verdict.
 */
const UNAVAILABLE = {
  valid: false,
  retryable: true,
  error: "We couldn't check that licence just now. Try again in a moment.",
} as const;

type Body = Record<string, unknown>;

async function readBody(request: Request): Promise<Body> {
  try {
    const parsed: unknown = await request.json();
    return parsed && typeof parsed === "object" ? (parsed as Body) : {};
  } catch {
    return {};
  }
}

function stringField(body: Body, name: string): string {
  const value = body[name];
  return typeof value === "string" ? value.trim().slice(0, 400) : "";
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Nothing here is cacheable: the answer is about one bearer credential
      // and it changes the moment a seat is taken or a refund lands.
      "cache-control": "no-store, private",
    },
  });
}

/**
 * The ceiling, and the refund that makes it charge misses rather than lookups.
 *
 * Charge-first and refund-on-success, which is the order `refundRateLimit`'s
 * own note argues for: peeking and charging afterwards leaves every request in
 * a concurrent burst passing a ceiling that should have stopped all but the
 * first few.
 *
 * Keyed on the *normalized* key so a guesser cannot buy a fresh bucket by
 * changing the dashes.
 */
async function guard(
  rawKey: string,
  run: () => Promise<{ result: LicenseResult; body: unknown; status: number }>,
): Promise<Response> {
  const normalized = normalizeLicenseKey(rawKey);
  if (!normalized) return json(REFUSED, 200);

  const bucket = `license:${normalized}`;
  const verdict = await rateLimit(bucket, LICENSE_LIMIT, LICENSE_WINDOW_SECONDS, {
    // DECISION B — fails closed. This endpoint's answer says whether a licence
    // exists, so an outage with no ceiling is exactly the window an enumeration
    // run wants.
    onOutage: "closed",
  });

  if (!verdict.allowed) {
    /*
     * `reason` is read rather than the boolean alone. `over` is the caller
     * having spent their budget; `outage` is Sailo unable to check at all, and
     * telling a paying customer's software their licence is invalid because
     * our Redis is down would uninstall a product somebody bought. Both get
     * the same retryable body, which is the honest answer to both.
     */
    return json(UNAVAILABLE, 429);
  }

  const { result, body, status } = await run();

  /*
   * A hit costs nothing. A miss keeps its charge — which is the whole point:
   * the budget rations guessing rather than use, so a customer whose software
   * validates on every launch never sees this limit and a caller walking the
   * keyspace pays for every step.
   */
  if (result.valid) await refundRateLimit(bucket, LICENSE_WINDOW_SECONDS);

  return json(body, status);
}

/**
 * What a caller is told about a live licence.
 *
 * Deliberately does not carry the buyer's email, the order number, the product
 * title or the shop. This runs inside a stranger's binary; everything it
 * returns is everything anyone holding the key can read, and none of the above
 * is needed to decide whether the software should run.
 */
function ok(result: Extract<LicenseResult, { valid: true }>) {
  return {
    valid: true,
    instance_id: result.instanceId,
    expires_at: result.expiresAt?.toISOString() ?? null,
    activation_limit: result.activationLimit,
    activation_usage: result.activationsUsed,
  };
}

/**
 * A refusal, shaped by whether the caller has proved they hold the key.
 *
 * `unknown` collapses into `REFUSED` and must keep collapsing into it: that is
 * the single line standing between this endpoint and a key-existence oracle.
 */
function refusal(result: Extract<LicenseResult, { valid: false }>) {
  if (result.reason === "unknown") return REFUSED;
  return { valid: false, reason: result.reason };
}

export async function handleLicenseActivate(request: Request): Promise<Response> {
  const body = await readBody(request);
  const key = stringField(body, "key");
  const instance =
    stringField(body, "instance_identifier") || stringField(body, "instance_id");

  return guard(key, async () => {
    /*
     * A missing instance identifier is refused *as an unknown key*, not as a
     * validation error. "Your instance id is missing" told to a caller with a
     * made-up key confirms the key parsed, and the distinction between
     * malformed-request and unknown-key is precisely the distinction an
     * enumeration run is looking for.
     */
    if (!instance) {
      return { result: { valid: false, reason: "unknown" }, body: REFUSED, status: 200 };
    }

    const result = await activateLicense({
      key,
      instanceIdentifier: instance,
      instanceName: stringField(body, "instance_name") || null,
      ip: callerAddress(request),
      userAgent: request.headers.get("user-agent"),
    });

    if (!result.valid) {
      logRefusal("activate", key, result.reason);
      return { result, body: refusal(result), status: 200 };
    }
    return { result, body: ok(result), status: 200 };
  });
}

export async function handleLicenseValidate(request: Request): Promise<Response> {
  const body = await readBody(request);
  const key = stringField(body, "key");
  const instance =
    stringField(body, "instance_identifier") || stringField(body, "instance_id");

  return guard(key, async () => {
    const result = await validateLicense({
      key,
      instanceIdentifier: instance || null,
    });
    if (!result.valid) {
      logRefusal("validate", key, result.reason);
      return { result, body: refusal(result), status: 200 };
    }
    return { result, body: ok(result), status: 200 };
  });
}

export async function handleLicenseDeactivate(request: Request): Promise<Response> {
  const body = await readBody(request);
  const key = stringField(body, "key");
  const instance =
    stringField(body, "instance_identifier") || stringField(body, "instance_id");

  return guard(key, async () => {
    const done = instance
      ? await deactivateLicense({ key, instanceIdentifier: instance })
      : { deactivated: false };

    /*
     * `deactivated: false` covers an unknown key, a disabled key and an
     * instance that was already off — one answer for all three, for the same
     * reason `REFUSED` is one answer for the first two.
     *
     * The rate-limit result is reported as valid only when something actually
     * happened, so a caller sweeping made-up keys through this endpoint pays
     * for every one of them exactly as they would through `validate`.
     */
    return {
      result: done.deactivated
        ? ({
            valid: true,
            instanceId: instance,
            expiresAt: null,
            activationLimit: null,
            activationsUsed: 0,
            productId: "",
          } satisfies LicenseResult)
        : ({ valid: false, reason: "unknown" } satisfies LicenseResult),
      body: { deactivated: done.deactivated },
      status: 200,
    };
  });
}

/**
 * The caller's address, from the proxy headers this platform sets.
 *
 * Not `callerIp` from `@sailo/rate-limit/client-ip`: that reaches for
 * `next/headers`, and these handlers are given the `Request` directly so the
 * header is right here. Recorded on the activation because an activation from
 * an address at a time is the strongest evidence a software sale can produce
 * against a `product_not_received` dispute.
 */
function callerAddress(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return request.headers.get("x-real-ip");
}

/**
 * The prefix, never the key.
 *
 * A licence key in a log line is a credential in a log aggregator, shared with
 * everyone who can read logs and retained for as long as the retention policy
 * says. Five characters is enough to tell two support cases apart and not
 * enough to be anybody's licence.
 */
function logRefusal(endpoint: string, key: string, reason: string): void {
  console.info(
    `[sailo] license ${endpoint} refused: ${reason} (key ${licenseKeyPrefix(key) || "?"}…)`,
  );
}
