import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { apiKeys, shops, type ApiKey, type Shop } from "@sailo/db/schema";
import { withRedis } from "@/lib/redis";

/**
 * Minting, storing and recognising the token that lets a program act on a
 * shop — over `/api/v1` and over `/api/mcp`, which are the same grant.
 *
 * The whole design is one sentence: **the only copy of the token we keep is a
 * hash, and the only time the seller can see the token is the moment it is
 * created.** Everything else follows from that — the prefix column exists
 * because a hash cannot be shown in a list, revocation is a stamp because a
 * deleted row cannot answer questions after a leak, and there is no "show key"
 * button anywhere in the admin because there is nothing to show.
 */

/* -------------------------------------------------------------------------- */
/*  Scopes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Two, and deliberately not more.
 *
 * A per-resource scope matrix is the obvious next step and it is the wrong
 * one for this product: a seller wiring Zapier is not going to reason about
 * eleven checkboxes, and a scope nobody understands is a scope everybody
 * grants. The line that actually matters to somebody handing a key to a tool —
 * or to a language model — is whether it can *change* anything, and that is
 * the line these two draw.
 */
export const API_SCOPES = ["read", "write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === "string" && (API_SCOPES as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------- */
/*  The token                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `sailo_sk_` — recognisable in a log, a screenshot or a leaked repository.
 *
 * Secret-scanning services key off exactly this kind of fixed prefix, and a
 * token that looks like ordinary base64 is one nobody's tooling will ever spot
 * in a public commit. It costs nine characters.
 */
const TOKEN_PREFIX = "sailo_sk_";

/** 32 bytes, base64url — 256 bits, and nothing in a URL needs escaping. */
const TOKEN_BYTES = 32;

/**
 * How much of the token is kept in the clear, for the list in the admin.
 *
 * Six characters of base64url is 36 bits. Enough that a seller with three keys
 * can tell them apart at a glance, and far too little to narrow a guess
 * against the 256 bits behind it.
 */
const PREFIX_CHARS = 6;

export type MintedKey = {
  /** The whole token. Shown once, never stored, never recoverable. */
  token: string;
  prefix: string;
  tokenHash: string;
};

export function mintApiKey(): MintedKey {
  const secret = randomBytes(TOKEN_BYTES).toString("base64url");
  const token = `${TOKEN_PREFIX}${secret}`;
  return {
    token,
    prefix: `${TOKEN_PREFIX}${secret.slice(0, PREFIX_CHARS)}`,
    tokenHash: hashToken(token),
  };
}

/**
 * SHA-256, hex.
 *
 * Not bcrypt, not argon2, and that is the right call rather than a shortcut.
 * A slow KDF exists to make a *low-entropy* secret expensive to guess; there
 * are 256 bits of `randomBytes` in here, so there is nothing to guess and the
 * only thing a work factor would buy is a deliberately slow hash on the hot
 * path of every API and MCP request. It is the same reasoning session tokens
 * are stored under.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Whether a string is even shaped like one of ours, before we ask the database. */
export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(TOKEN_PREFIX) && value.length > TOKEN_PREFIX.length + 20;
}

/* -------------------------------------------------------------------------- */
/*  Recognising one                                                            */
/* -------------------------------------------------------------------------- */

export type ResolvedKey = { key: ApiKey; shop: Shop };

/**
 * The token a caller presented, turned into the shop it speaks for.
 *
 * One indexed lookup on the hash, joined to the shop. `revokedAt is null` is
 * in the WHERE rather than checked afterwards, so a revoked key is not merely
 * refused — it does not resolve at all, and no code path downstream can
 * accidentally hold a shop it should not have.
 *
 * Returns null for every failure, with no distinction between "no such key"
 * and "revoked". A caller learning which of the two it was would learn that a
 * token they hold *used* to be real, and there is no legitimate use for that.
 */
export async function resolveApiKey(token: string): Promise<ResolvedKey | null> {
  if (!looksLikeApiKey(token)) return null;

  const rows = await getDb()
    .select({ key: apiKeys, shop: shops })
    .from(apiKeys)
    .innerJoin(shops, eq(shops.id, apiKeys.shopId))
    .where(and(eq(apiKeys.tokenHash, hashToken(token)), isNull(apiKeys.revokedAt)))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Stamps `lastUsedAt`, at most once an hour per key.
 *
 * The question this column answers is "is anything still using this key, or
 * can I revoke it", and an hour's resolution answers it exactly as well as a
 * write per request would — while a write per request would put an UPDATE on
 * the hot path of an endpoint built to be called in a loop.
 *
 * The throttle lives in Redis and fails *closed* on purpose, which is the
 * opposite of every other limiter in this codebase: with no Redis the marker
 * cannot be set, so writing anyway would mean an UPDATE on every request. The
 * cost of being wrong here is a stale timestamp in a list, which is nothing.
 */
export async function touchApiKey(keyId: string): Promise<void> {
  const fresh = await withRedis(async (redis) => {
    // NX: only the first caller in the window gets the key, so only one writes.
    const set = await redis.set(`sailo:apikey-touch:${keyId}`, "1", {
      NX: true,
      EX: 3600,
    });
    return set === "OK";
  }, false);

  if (!fresh) return;

  try {
    await getDb()
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, keyId));
  } catch (error) {
    // A bookkeeping column is never worth failing a request over.
    console.warn("[sailo] api key touch failed", error);
  }
}
