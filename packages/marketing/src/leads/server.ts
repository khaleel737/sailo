import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { leads, products, shops } from "@sailo/db/schema";
import type { Lead, Product, Shop } from "@sailo/db/schema";
import type { LeadAnswer } from "@sailo/db/schema/json-types";
import { maybeRow } from "@sailo/core/invariant";
import { randomHex } from "@sailo/core/token";

/**
 * Writing a lead, and handing over the magnet it earned.
 *
 * Deliberately its own path rather than a zero-value order. A lead takes no
 * invoice number, reserves no stock, appears in no revenue figure and never
 * touches the ledger — spec 07 — and the way to guarantee that is for none of
 * this to reach the code that does those things.
 */

/**
 * SHA-256, hex — the same treatment `resolveApiKey` gives a key, and for the
 * same reason: there are 128 bits of `randomHex` in the token, so a work factor
 * would buy a slow hash on a public path and nothing else.
 */
export function hashMagnetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function newMagnetToken(): string {
  // Sixteen bytes: this is a bearer link to a free file, in the same class as
  // an order's download token, which mints the same width.
  return randomHex(16);
}

export type SaveLeadInput = {
  shopId: string;
  productId: string;
  clientId: string | null;
  email: string;
  name: string | null;
  answers: LeadAnswer[];
  /** Set only when the product has files; null leaves any old token alone. */
  magnet: { tokenHash: string; expiresAt: Date | null } | null;
};

/**
 * One row per (product, address), created or updated.
 *
 * A resubmission updates rather than duplicating — spec 07 — because a seller
 * counting leads needs the number to be people rather than clicks. Keyed on the
 * folded address rather than on `client_id`: that column is nullable, and
 * Postgres treats two NULLs in a unique index as distinct, so a shop that had
 * deleted two contacts could collect the same lead twice.
 *
 * Answers are replaced rather than merged. A person filling the form in again
 * is correcting what they said, and merging would leave them unable to change
 * an answer they had regretted.
 */
export async function saveLead(input: SaveLeadInput): Promise<Lead> {
  const db = getDb();
  const email = input.email.trim().toLowerCase();

  const [row] = await db
    .insert(leads)
    .values({
      shopId: input.shopId,
      productId: input.productId,
      clientId: input.clientId,
      email,
      name: input.name,
      answers: input.answers,
      magnetTokenHash: input.magnet?.tokenHash ?? null,
      magnetExpiresAt: input.magnet?.expiresAt ?? null,
    })
    .onConflictDoUpdate({
      target: [leads.productId, leads.email],
      set: {
        clientId: input.clientId,
        name: input.name,
        answers: input.answers,
        /*
         * A fresh magnet token on every submission, and the allowance with it.
         *
         * The alternative — keep the first token for ever — means a buyer who
         * lost the email can never get the file again without the seller doing
         * something, and a token whose cap ran out is dead for good. Minting a
         * new one is also what makes the old one stop working, which is the
         * revocation half of "single-audience, revocable".
         *
         * `coalesce` leaves an existing token alone when this submission has no
         * magnet to give — a product that lost its files should not silently
         * strip a link somebody already holds.
         */
        magnetTokenHash: input.magnet
          ? input.magnet.tokenHash
          : sql`${leads.magnetTokenHash}`,
        magnetExpiresAt: input.magnet
          ? input.magnet.expiresAt
          : sql`${leads.magnetExpiresAt}`,
        magnetDownloads: input.magnet ? 0 : sql`${leads.magnetDownloads}`,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!row) throw new Error("lead upsert returned nothing");
  return row;
}

export type MagnetGrant = {
  lead: Lead;
  shop: Shop;
  product: Product;
};

/**
 * What a magnet link is allowed to open, decided at request time.
 *
 * Entitlement is asked on every request rather than when the link was minted,
 * exactly as the order download route asks: the token was emailed once and
 * lives in an inbox for good, so a rule checked at mint time is a rule that
 * stopped being checked.
 *
 * Returns null for every failure with no distinction between "no such token",
 * "expired" and "used up" *here* — the caller decides what to say, and the page
 * says the same thing for all three so the link is not an oracle about which
 * leads a shop holds.
 */
export async function magnetForToken(token: string): Promise<MagnetGrant | null> {
  if (!token || token.length < 16) return null;
  const db = getDb();

  const row = await db
    .select({ lead: leads, shop: shops, product: products })
    .from(leads)
    .innerJoin(shops, eq(shops.id, leads.shopId))
    .innerJoin(products, eq(products.id, leads.productId))
    .where(
      and(
        eq(leads.magnetTokenHash, hashMagnetToken(token)),
        or(isNull(leads.magnetExpiresAt), gt(leads.magnetExpiresAt, new Date())),
        // A shop that is gone hands nothing over, the same rule every other
        // public read applies. `isShopLive` in code form, in the WHERE.
        eq(shops.isPublished, true),
        isNull(shops.suspendedAt),
        isNull(shops.deletedAt),
      ),
    )
    .limit(1);

  const found = maybeRow(row);
  return found ? { lead: found.lead, shop: found.shop, product: found.product } : null;
}

/**
 * Spends one download against the product's own cap, in the statement that
 * reads it.
 *
 * Check-then-act is the third of the six recurring bug shapes, and here it
 * means two open tabs both spending the last allowance. The ceiling is in the
 * WHERE, so exactly one of them wins.
 *
 * A null `downloadLimit` is a seller who set no cap and means it — the same
 * reading the order route gives the same column.
 */
export async function claimMagnetDownload(
  leadId: string,
  limit: number | null,
): Promise<boolean> {
  const claimed = maybeRow(
    await getDb()
      .update(leads)
      .set({ magnetDownloads: sql`${leads.magnetDownloads} + 1` })
      .where(
        and(
          eq(leads.id, leadId),
          isNotNull(leads.magnetTokenHash),
          or(isNull(leads.magnetExpiresAt), gt(leads.magnetExpiresAt, new Date())),
          limit === null
            ? sql`true`
            : sql`${leads.magnetDownloads} < ${limit}`,
        ),
      )
      .returning({ id: leads.id }),
  );
  return claimed !== null;
}

/** Hands an allowance back when nothing was actually delivered. */
export async function releaseMagnetDownload(leadId: string): Promise<void> {
  await getDb()
    .update(leads)
    .set({ magnetDownloads: sql`greatest(${leads.magnetDownloads} - 1, 0)` })
    .where(eq(leads.id, leadId));
}
