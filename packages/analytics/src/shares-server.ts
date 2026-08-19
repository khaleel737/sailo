import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { analyticsShares } from "@sailo/db/schema";
import { appOrigin } from "@sailo/core/origin";
import {
  isShareMetric,
  isShareRange,
  shareExpiry,
  shareScope,
  shareState,
  type ShareMetric,
  type ShareRange,
} from "./shares";

/**
 * Minting, reading and revoking a share link.
 *
 * **The token is hashed, like `api_keys`.** A dump of this table is not a set
 * of working links, and the same reasoning applies as there: what is stored is
 * a fast hash rather than a slow one, because the secret is 256 bits of
 * randomness — a KDF would only make every public page view expensive to
 * defend against guessing that is already infeasible.
 *
 * **The token is returned exactly once**, at creation. There is no query in
 * this file that hands one back, because a link a seller can re-read from a
 * settings page is a link that lives in a browser cache and a screenshot.
 */

const TOKEN_BYTES = 32;
/** The leading characters, so a settings list can name a link without holding one. */
const PREFIX_LENGTH = 8;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type CreateShareOutcome =
  | { ok: true; token: string; url: string; expiresAt: Date }
  | { ok: false; reason: "metric" | "range" | "expiry" | "limit" };

/** How many live links one shop may have. Past this it is a public dashboard. */
export const MAX_LIVE_SHARES = 20;

/**
 * Mints a link to one number.
 *
 * The metric and the range are validated here and stored on the row. They are
 * deliberately **not** in the URL: the token cannot be edited into a different
 * figure or a wider window because there is nothing in the address to edit.
 */
export async function createShare(input: {
  shopId: string;
  metric: string;
  range: string;
  days?: number | null;
  createdByEmail?: string | null;
  now?: Date;
}): Promise<CreateShareOutcome> {
  const now = input.now ?? new Date();

  if (!isShareMetric(input.metric)) return { ok: false, reason: "metric" };
  if (!isShareRange(input.range)) return { ok: false, reason: "range" };

  const expiry = shareExpiry(input.days, now);
  if (!expiry.ok) return { ok: false, reason: "expiry" };

  const [{ n } = { n: "0" }] = await getDb()
    .select({ n: sql<string>`count(*)` })
    .from(analyticsShares)
    .where(
      and(
        eq(analyticsShares.shopId, input.shopId),
        sql`${analyticsShares.revokedAt} is null and ${analyticsShares.expiresAt} > ${now}`,
      ),
    );
  if (Number(n) >= MAX_LIVE_SHARES) return { ok: false, reason: "limit" };

  const token = randomBytes(TOKEN_BYTES).toString("base64url");

  await getDb().insert(analyticsShares).values({
    shopId: input.shopId,
    metric: input.metric,
    range: input.range,
    tokenHash: hashToken(token),
    tokenPrefix: token.slice(0, PREFIX_LENGTH),
    expiresAt: expiry.expiresAt,
    createdByEmail: input.createdByEmail ?? null,
  });

  return { ok: true, token, url: shareUrl(token), expiresAt: expiry.expiresAt };
}

/** Where a share link points. `noindex` is set by the page itself. */
export function shareUrl(token: string, base = appOrigin()): string {
  return `${base}/s/stat/${encodeURIComponent(token)}`;
}

export type ResolvedShare = {
  id: string;
  shopId: string;
  metric: ShareMetric;
  range: ShareRange;
};

/**
 * Resolves a token to exactly what it may show, or null.
 *
 * Null for every refusal — unknown, expired, revoked, or a row whose stored
 * metric this build does not recognise. The public page says the same sentence
 * for all four, because "this link has expired" and "this link never existed"
 * are different facts about a shop that nobody browsing needs.
 *
 * The comparison is `timingSafeEqual` over the hashes rather than a WHERE on
 * the hash alone — the index lookup is what finds the row, and the constant-
 * time compare is what stops the *shape* of a near-miss being measurable.
 */
export async function resolveShare(
  token: string,
  now = new Date(),
): Promise<ResolvedShare | null> {
  if (!token || token.length > 200) return null;

  const hash = hashToken(token);
  const row = await getDb().query.analyticsShares.findFirst({
    where: eq(analyticsShares.tokenHash, hash),
  });
  if (!row) return null;

  const presented = Buffer.from(hash, "hex");
  const stored = Buffer.from(row.tokenHash, "hex");
  if (presented.length !== stored.length) return null;
  if (!timingSafeEqual(presented, stored)) return null;

  if (shareState(row, now) !== "live") return null;

  /*
   * A row whose metric or range this build does not know. Not a hypothetical:
   * a newer deploy could add one, and this build rendering "whatever that
   * means" would be a public page guessing at what it is allowed to show.
   */
  const scope = shareScope(row);
  if (!scope) return null;

  return { id: row.id, shopId: row.shopId, metric: scope.metric, range: scope.range };
}

/**
 * Records that a link was looked at.
 *
 * Deferred by the caller and never awaited on the render path: a counter must
 * not sit between a viewer and the page. It is here because "last viewed" is
 * the column a seller actually reads when deciding whether to revoke — a link
 * nobody has opened in six months is one they can take back without asking.
 */
export async function recordShareView(id: string, now = new Date()): Promise<void> {
  await getDb()
    .update(analyticsShares)
    .set({
      lastViewedAt: now,
      viewCount: sql`${analyticsShares.viewCount} + 1`,
    })
    .where(eq(analyticsShares.id, id));
}

/** The settings list. Never returns a token — there is none to return. */
export async function sharesFor(shopId: string, now = new Date()) {
  const rows = await getDb()
    .select({
      id: analyticsShares.id,
      metric: analyticsShares.metric,
      range: analyticsShares.range,
      tokenPrefix: analyticsShares.tokenPrefix,
      expiresAt: analyticsShares.expiresAt,
      revokedAt: analyticsShares.revokedAt,
      createdByEmail: analyticsShares.createdByEmail,
      lastViewedAt: analyticsShares.lastViewedAt,
      viewCount: analyticsShares.viewCount,
      createdAt: analyticsShares.createdAt,
    })
    .from(analyticsShares)
    .where(eq(analyticsShares.shopId, shopId))
    .orderBy(desc(analyticsShares.createdAt));

  return rows.map((row) => ({ ...row, state: shareState(row, now) }));
}

/**
 * Revokes a link.
 *
 * Scoped by the shop id in the same statement, and idempotent: a second
 * revoke is a no-op rather than an error, because the seller pressing it twice
 * is a seller who is not sure it worked.
 */
export async function revokeShare(
  shopId: string,
  id: string,
  now = new Date(),
): Promise<boolean> {
  const [updated] = await getDb()
    .update(analyticsShares)
    .set({ revokedAt: now })
    .where(
      and(
        eq(analyticsShares.id, id),
        eq(analyticsShares.shopId, shopId),
        sql`${analyticsShares.revokedAt} is null`,
      ),
    )
    .returning({ id: analyticsShares.id });
  return Boolean(updated);
}
