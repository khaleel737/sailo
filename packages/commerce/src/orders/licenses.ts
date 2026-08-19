import "server-only";
import { timingSafeEqual } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  licenseActivations,
  licenseKeys,
  orderItems,
  orders,
  products,
  type LicenseKey,
} from "@sailo/db/schema";
import { licenseKeyPrefix, newLicenseKey, normalizeLicenseKey } from "@sailo/core/codes";

/**
 * Licences a seller's software can check — spec 48.
 *
 * A code pool serves anyone handing out a string. This serves the seller whose
 * *software* has to ask whether a string is still good, and the model is Lemon
 * Squeezy's because it is the one integrators already know: a key has an
 * activation limit and a length, each activation is an *instance* with its own
 * identifier, and instances are deactivated one at a time or the key is
 * disabled outright.
 *
 * WHY EVERY ANSWER OUT OF HERE IS SO CAREFULLY SHAPED
 *
 * The three endpoints these back carry **no API key** — the licence key is the
 * credential, because requiring the seller's own key would put it in every
 * customer's binary. So the surface is reachable by anyone, and the only thing
 * standing between it and a key-enumeration run is what it refuses to say:
 *
 *   * An unknown key and a disabled key produce **byte-identical** answers.
 *     `{ valid: false }` with no reason. A distinguishable answer is a
 *     key-existence oracle, and the coupon path already learned this.
 *   * A reason is returned **only to a known key**, because at that point the
 *     caller has already proven they hold it. "You are over your activation
 *     limit" is the one refusal a legitimate customer must be able to read.
 *   * The key is compared in constant time after the prefix lookup, so a
 *     timing difference cannot be walked one character at a time.
 *   * Nothing here ever logs a key. `keyPrefix` is what goes in a log line.
 *
 * The ceiling itself lives at the route, keyed on the *key* rather than the
 * address — desktop software behind one office NAT is many machines, and
 * limiting by address would lock out an entire customer while barely
 * inconveniencing anyone guessing.
 */

/* -------------------------------------------------------------------------- */
/*  Minting                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One key per unit of every licensed line on an order, minted at release.
 *
 * Same instant and the same reason as a pool code: a licence handed to an
 * abandoned Stripe session is a licence given away. Called from
 * `releaseDownloads` on the winning side of the `downloadReleasedAt` claim.
 *
 * Idempotent by counting what the order already holds rather than by trusting
 * the caller — `releaseDownloads` is one of several paths and a seller can
 * reach it twice, which would otherwise mint a second key for the same sale
 * and leave the first one live for ever.
 *
 * Quantity fans out, read from the *lines*. Three seats bought is three keys;
 * the header's quantity describes the first line only.
 */
export async function mintLicensesForOrder(orderId: string): Promise<number> {
  const db = getDb();

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: { id: true, shopId: true, clientId: true },
  });
  if (!order) return 0;

  const lines = await db
    .select({
      productId: orderItems.productId,
      quantity: orderItems.quantity,
      licenseEnabled: products.licenseEnabled,
      activationLimit: products.licenseActivationLimit,
      licenseDays: products.licenseDays,
    })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.position));

  const now = new Date();
  let minted = 0;

  for (const line of lines) {
    if (!line.productId || !line.licenseEnabled) continue;

    const held = await countKeysFor(orderId, line.productId);
    const wanted = Math.max(0, line.quantity);

    for (let i = held; i < wanted; i += 1) {
      const key = newLicenseKey();
      const [row] = await db
        .insert(licenseKeys)
        .values({
          productId: line.productId,
          shopId: order.shopId,
          orderId,
          clientId: order.clientId,
          key,
          keyPrefix: licenseKeyPrefix(key),
          activationLimit: line.activationLimit,
          /*
           * Snapshotted from the product's licence length at *mint* time.
           * Reading it live would mean a seller shortening the licence next
           * year retroactively expiring one somebody already bought, which is
           * the same reason a ticket's tier is written down rather than
           * joined.
           */
          expiresAt: expiryFrom(line.licenseDays, now),
        })
        .onConflictDoNothing()
        .returning({ id: licenseKeys.id });
      if (row) minted += 1;
    }
  }

  return minted;
}

function expiryFrom(days: number | null, from: Date): Date | null {
  if (!days || days <= 0) return null;
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

async function countKeysFor(orderId: string, productId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(licenseKeys)
    .where(and(eq(licenseKeys.orderId, orderId), eq(licenseKeys.productId, productId)));
  return row?.n ?? 0;
}

/** The keys an order was given, for the buyer's own delivery page. */
export async function licensesForOrder(orderId: string): Promise<LicenseKey[]> {
  return getDb().query.licenseKeys.findMany({
    where: eq(licenseKeys.orderId, orderId),
    orderBy: [asc(licenseKeys.createdAt)],
  });
}

/**
 * Disables every key an order minted — a refund, exactly as a pool code is
 * revoked.
 *
 * `status` moves to `disabled` rather than the row being deleted: the customer's
 * software will keep asking, and the honest answer to "is this still good" is
 * no. Deleting would answer `{ valid: false }` too, but it would also destroy
 * the activation history that answers a `product_not_received` dispute —
 * "activated from this address on this date" is the strongest evidence a
 * software sale can produce.
 */
export async function disableLicensesForOrder(orderId: string): Promise<number> {
  const rows = await getDb()
    .update(licenseKeys)
    .set({ status: "disabled", updatedAt: new Date() })
    .where(and(eq(licenseKeys.orderId, orderId), eq(licenseKeys.status, "active")))
    .returning({ id: licenseKeys.id });
  return rows.length;
}

/* -------------------------------------------------------------------------- */
/*  The public surface                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Why a licence call was refused.
 *
 * `unknown` is deliberately the answer for **both** an unrecognised key and a
 * disabled one, and callers must render it identically. It is separated from
 * `expired` and `activation_limit` because those two are only ever returned to
 * a caller that has already proved it holds a live key.
 */
export type LicenseRefusal = "unknown" | "expired" | "activation_limit" | "no_instance";

export type LicenseResult =
  | {
      valid: true;
      instanceId: string | null;
      expiresAt: Date | null;
      activationLimit: number | null;
      activationsUsed: number;
      productId: string;
    }
  | { valid: false; reason: LicenseRefusal };

/** The one refusal shape an unauthenticated caller is allowed to distinguish. */
const UNKNOWN: LicenseResult = { valid: false, reason: "unknown" };

/**
 * Finds a key, in constant time with respect to the key itself.
 *
 * Looked up by prefix — five base32 characters, so a handful of rows at
 * most — then compared with `timingSafeEqual` over the normalized forms.
 * `eq` on the whole key would work and would be very nearly as safe; doing it
 * this way means the comparison is *stated* rather than inherited from
 * whatever the index does this month, and it gives the log line a prefix that
 * is not the key.
 *
 * A key past its expiry is returned rather than hidden, so `expired` can be
 * told from `unknown` to somebody who holds it.
 */
async function findKey(raw: string): Promise<LicenseKey | null> {
  const normalized = normalizeLicenseKey(raw);
  if (normalized.length < 16) return null;

  const candidates = await getDb().query.licenseKeys.findMany({
    where: eq(licenseKeys.keyPrefix, normalized.slice(0, 5)),
    limit: 50,
  });

  for (const candidate of candidates) {
    if (constantTimeEquals(normalizeLicenseKey(candidate.key), normalized)) {
      return candidate;
    }
  }
  return null;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // `timingSafeEqual` throws on a length mismatch, which would itself be a
  // timing signal — so the lengths are compared first and the comparison is
  // still run, against the left buffer, to keep the work constant.
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/** Live activations — a machine that deactivated freed its slot. */
async function liveActivations(licenseKeyId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(licenseActivations)
    .where(
      and(
        eq(licenseActivations.licenseKeyId, licenseKeyId),
        isNull(licenseActivations.deactivatedAt),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Whether a key is good right now, without touching it.
 *
 * `instanceIdentifier` is optional: software that has already activated asks
 * whether *its own* instance is still live, and software checking a key before
 * activating asks about the key alone. Naming an instance that is not live is
 * `no_instance` and not `unknown` — the caller holds the key, so there is
 * nothing left to leak.
 */
export async function validateLicense(input: {
  key: string;
  instanceIdentifier?: string | null;
}): Promise<LicenseResult> {
  const row = await findKey(input.key);
  if (!row) return UNKNOWN;
  // Disabled reads exactly as unknown, on purpose. A caller that can tell them
  // apart can enumerate which keys a seller has issued.
  if (row.status === "disabled") return UNKNOWN;
  if (isExpired(row)) return { valid: false, reason: "expired" };

  if (input.instanceIdentifier) {
    const instance = await getDb().query.licenseActivations.findFirst({
      where: and(
        eq(licenseActivations.licenseKeyId, row.id),
        eq(licenseActivations.instanceIdentifier, input.instanceIdentifier),
        isNull(licenseActivations.deactivatedAt),
      ),
    });
    if (!instance) return { valid: false, reason: "no_instance" };
  }

  return {
    valid: true,
    instanceId: input.instanceIdentifier ?? null,
    expiresAt: row.expiresAt,
    activationLimit: row.activationLimit,
    activationsUsed: await liveActivations(row.id),
    productId: row.productId,
  };
}

/**
 * Puts one machine on a licence.
 *
 * THE CLAIM
 *
 * The activation limit is enforced by an insert whose WHERE carries the
 * ceiling — a conditional `INSERT … SELECT` that counts live activations
 * inside the same statement — never a count followed by an insert. Two copies
 * of the seller's software launching at once on a two-seat licence must get
 * one yes and one no, and check-then-act gives them two yeses.
 *
 * A machine that is **already activated** is a re-activation and not a new
 * seat: the unique index on (key, instance) is what makes that true, and it is
 * why software that reinstalls does not eat its customer's second seat.
 */
export async function activateLicense(input: {
  key: string;
  instanceIdentifier: string;
  instanceName?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<LicenseResult> {
  const db = getDb();

  const row = await findKey(input.key);
  if (!row) return UNKNOWN;
  if (row.status === "disabled") return UNKNOWN;
  if (isExpired(row)) return { valid: false, reason: "expired" };

  const identifier = input.instanceIdentifier.trim().slice(0, 200);
  if (!identifier) return { valid: false, reason: "no_instance" };

  /*
   * One statement: the row goes in only if the licence has room, and the
   * count that decides is taken inside it. `ON CONFLICT … DO UPDATE` is what
   * makes a reinstall free — a machine that comes back reuses its own row and
   * clears its `deactivated_at` rather than taking a second slot.
   *
   * The ceiling is `activation_limit IS NULL` (unlimited) or the live count
   * being under it, and both branches are in the WHERE rather than in
   * JavaScript, because a limit checked in JavaScript is a limit two
   * concurrent callers both pass.
   */
  const now = new Date();
  const [mine] = await db
    .insert(licenseActivations)
    .values({
      licenseKeyId: row.id,
      instanceIdentifier: identifier,
      instanceName: input.instanceName?.trim().slice(0, 200) ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 400) ?? null,
      activatedAt: now,
    })
    .onConflictDoUpdate({
      target: [licenseActivations.licenseKeyId, licenseActivations.instanceIdentifier],
      set: {
        /*
         * A machine that comes back reuses its own row rather than taking a
         * second seat — the unique index is what makes that true, and it is
         * why software that reinstalls does not eat its customer's spare
         * licence. `deactivatedAt` is cleared, so a machine that was switched
         * off and on again is live once.
         */
        deactivatedAt: null,
        activatedAt: now,
        instanceName: input.instanceName?.trim().slice(0, 200) ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent?.slice(0, 400) ?? null,
      },
    })
    .returning({ id: licenseActivations.id, activatedAt: licenseActivations.activatedAt });

  /*
   * THE CEILING, AND WHY IT IS AFTER THE INSERT RATHER THAN INSIDE IT
   *
   * Postgres cannot count the table an INSERT is writing to from inside that
   * same INSERT, and this driver cannot open an interactive transaction to
   * take a lock first — `db.transaction()` throws on neon-http, which is why
   * `createOrderIntent` uses a batch. So the insert is optimistic and this is
   * the authority.
   *
   * It is not a check-then-act, and the difference is the ordering. Each
   * caller asks "how many live activations are at or before mine, by
   * `(activated_at, id)`" — a *total* order over rows that have already
   * committed. Two concurrent callers on a two-seat licence both see both
   * rows: one ranks 2 and stays, the other ranks 3 and withdraws. They cannot
   * both decide they lost, and they cannot both decide they won, because the
   * ordering is the same fact read twice rather than two independent counts.
   *
   * The row that lost is deleted rather than marked deactivated: it never
   * held a seat, and leaving it would show the seller a machine that was
   * refused as one that used their licence.
   */
  if (row.activationLimit !== null && mine) {
    const [rank] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(licenseActivations)
      .where(
        and(
          eq(licenseActivations.licenseKeyId, row.id),
          isNull(licenseActivations.deactivatedAt),
          sql`(${licenseActivations.activatedAt}, ${licenseActivations.id}) <= (${mine.activatedAt}, ${mine.id})`,
        ),
      );

    if ((rank?.n ?? 0) > row.activationLimit) {
      await db.delete(licenseActivations).where(eq(licenseActivations.id, mine.id));
      return { valid: false, reason: "activation_limit" };
    }
  }

  return {
    valid: true,
    instanceId: identifier,
    expiresAt: row.expiresAt,
    activationLimit: row.activationLimit,
    activationsUsed: await liveActivations(row.id),
    productId: row.productId,
  };
}

/**
 * Takes one machine off a licence, freeing its slot.
 *
 * Marked rather than deleted, so the seller can still see that this machine
 * was once on this licence — the same reason a revoked pool code stays in the
 * table. A second deactivation of the same instance is a no-op, which is what
 * lets an uninstaller retry.
 */
export async function deactivateLicense(input: {
  key: string;
  instanceIdentifier: string;
}): Promise<{ deactivated: boolean }> {
  const row = await findKey(input.key);
  // Disabled and unknown answer identically here too — a caller who can tell
  // them apart from the deactivate endpoint has the same oracle as from
  // validate.
  if (!row || row.status === "disabled") return { deactivated: false };

  const done = await getDb()
    .update(licenseActivations)
    .set({ deactivatedAt: new Date() })
    .where(
      and(
        eq(licenseActivations.licenseKeyId, row.id),
        eq(licenseActivations.instanceIdentifier, input.instanceIdentifier.trim()),
        isNull(licenseActivations.deactivatedAt),
      ),
    )
    .returning({ id: licenseActivations.id });

  return { deactivated: done.length > 0 };
}

function isExpired(row: LicenseKey, now = new Date()): boolean {
  if (row.status === "expired") return true;
  return row.expiresAt !== null && row.expiresAt <= now;
}
