import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { doorPasses, products, type DoorPass } from "@sailo/db/schema";
import { rateLimit } from "@/lib/redis";

/**
 * A credential for whoever is actually on the door.
 *
 * Before this, letting somebody scan meant handing them the seller's login,
 * which is also the payouts, the customer list, the product catalogue and the
 * bank details. Nobody does that, so in practice the owner worked every door
 * themselves or nobody checked tickets at all.
 *
 * The shape is the affiliate portal's (`lib/affiliate-portal.ts`): an
 * unguessable token on a row, reached by URL, with no account behind it. A
 * volunteer helping for one evening should not have to sign up for anything,
 * and revoking should bite on the next request rather than whenever a session
 * would have expired.
 *
 * The token is a bearer credential — whoever holds the link can admit people
 * to that event, and nothing more. That is the whole point, and it is also
 * why passes expire by default and why every read below refuses a revoked or
 * expired one rather than leaving that to the caller.
 */

export function newDoorToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function doorUrl(token: string, base = process.env.NEXT_PUBLIC_APP_URL) {
  return `${base ?? ""}/door/${token}`;
}

/**
 * A pass, and what it is allowed to work.
 *
 * `productId` null means every event in the shop, which is right for a venue
 * running four rooms on one night and wrong as a default — so the admin form
 * offers the event you are standing in first.
 */
export async function createDoorPass(input: {
  shopId: string;
  productId: string | null;
  name: string;
  expiresAt: Date | null;
}): Promise<DoorPass> {
  const [pass] = await getDb()
    .insert(doorPasses)
    .values({
      shopId: input.shopId,
      productId: input.productId,
      name: input.name.trim().slice(0, 80) || "Door",
      token: newDoorToken(),
      expiresAt: input.expiresAt,
    })
    .returning();
  if (!pass) throw new Error("door pass was not inserted");
  return pass;
}

export async function listDoorPasses(shopId: string, productId?: string | null) {
  return getDb().query.doorPasses.findMany({
    where: and(
      eq(doorPasses.shopId, shopId),
      // A shop-wide pass works this event too, so it belongs in this event's
      // list — otherwise a seller revokes what they can see and believes the
      // door is closed while a wildcard pass is still admitting people.
      productId
        ? sql`(${doorPasses.productId} = ${productId} or ${doorPasses.productId} is null)`
        : undefined,
    ),
    orderBy: [desc(doorPasses.createdAt)],
  });
}

export async function revokeDoorPass(shopId: string, passId: string) {
  const [row] = await getDb()
    .update(doorPasses)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(doorPasses.id, passId),
        eq(doorPasses.shopId, shopId),
        sql`${doorPasses.revokedAt} is null`,
      ),
    )
    .returning({ id: doorPasses.id });
  return Boolean(row);
}

export type DoorSession = {
  pass: DoorPass;
  /** The event this door works. Null only for a shop-wide pass. */
  event: {
    id: string;
    title: string;
    eventStartsAt: Date | null;
    serviceLocation: string | null;
  } | null;
};

/**
 * Reads a token back, or null for anything that must not open a door.
 *
 * Rate-limited on the token itself. The tokens are 192 bits and guessing one
 * is not a realistic attack, but this route is unauthenticated and reachable
 * from anywhere, and a ceiling is what stops it being a cheap way to probe
 * whether a shop is running an event tonight.
 */
export async function readDoorPass(
  token: string,
): Promise<DoorSession | null> {
  const clean = token.trim();
  if (!/^[0-9a-f]{48}$/.test(clean)) return null;

  const gate = await rateLimit(`door:${clean}`, 600, 60);
  if (!gate.allowed) return null;

  const pass = await getDb().query.doorPasses.findFirst({
    where: eq(doorPasses.token, clean),
  });
  if (!pass) return null;
  if (pass.revokedAt) return null;
  if (pass.expiresAt && pass.expiresAt <= new Date()) return null;

  const event = pass.productId
    ? ((await getDb().query.products.findFirst({
        where: and(
          eq(products.id, pass.productId),
          eq(products.shopId, pass.shopId),
        ),
        columns: {
          id: true,
          title: true,
          eventStartsAt: true,
          serviceLocation: true,
        },
      })) ?? null)
    : null;

  // A pass naming an event that has since been deleted is not a shop-wide
  // pass. Widening it on the way past would be the worst possible reading of
  // a missing row.
  if (pass.productId && !event) return null;

  return { pass, event };
}

/** Records that a pass was used, so an unused one is visibly unused. */
export async function touchDoorPass(passId: string, admitted: boolean) {
  await getDb()
    .update(doorPasses)
    .set({
      lastUsedAt: new Date(),
      ...(admitted
        ? { checkInCount: sql`${doorPasses.checkInCount} + 1` }
        : {}),
    })
    .where(eq(doorPasses.id, passId));
}
