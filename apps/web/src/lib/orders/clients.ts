import "server-only";
import { and, eq, or } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { clients } from "@sailo/db/schema";
import { maybeRow } from "@/lib/invariant";

/**
 * Finds or creates the buyer's record.
 *
 * Matched on email or phone, because a buyer who orders twice with the same
 * email is one customer, not two — the seller's client list is only useful if
 * it says that. Address fields are refreshed each time so the profile reflects
 * where they last had something sent.
 */

export async function upsertClient(
  shopId: string,
  data: {
    name: string | null;
    email: string | null;
    phone: string | null;
  } & Record<string, string | null>,
  /*
   * A separate argument rather than another key on `data`, whose index
   * signature is `string | null` — a Date on it would widen to something
   * neither this function nor its callers could read back.
   */
  consent?: { marketingConsentAt: Date | null },
) {
  const db = getDb();
  if (!data.email && !data.phone) return null;

  /*
   * Consent is granted, never revoked by omission.
   *
   * A buyer who opted in last month and left the optional box empty today did
   * not withdraw anything — they skipped a box, which is what optional boxes
   * are for. Writing `null` over their consent because this order did not
   * carry it would silently shrink the seller's lawful audience every time a
   * returning customer bought again, and nothing anywhere would report it.
   *
   * Withdrawal is a real thing a buyer must be able to do; it is unsubscribe,
   * and it is spec 14's to build. It is deliberately not this expression.
   */
  const grantedConsent = consent?.marketingConsentAt ?? null;

  const matchers = [];
  if (data.email) matchers.push(eq(clients.email, data.email));
  if (data.phone) matchers.push(eq(clients.phone, data.phone));
  const match = matchers.length === 1 ? matchers[0] : or(...matchers);

  const existing = await db.query.clients.findFirst({
    where: and(eq(clients.shopId, shopId), match),
  });

  const address = {
    addressLine1: data.addressLine1,
    addressLine2: data.addressLine2,
    city: data.city,
    region: data.region,
    postalCode: data.postalCode,
    country: data.country,
  };
  // Don't blank out a stored address when this order didn't collect one.
  const addressUpdate = Object.fromEntries(
    Object.entries(address).filter(([, v]) => v !== null),
  );

  if (existing) {
    await db
      .update(clients)
      .set({
        name: data.name ?? existing.name,
        email: data.email ?? existing.email,
        phone: data.phone ?? existing.phone,
        ...addressUpdate,
        // Grant-only. The same rule is applied again in the race-loser branch
        // below — the two update paths are one behaviour written twice, and a
        // rule added to only one of them is the bug shape this file has had.
        marketingConsentAt: grantedConsent ?? existing.marketingConsentAt,
        updatedAt: new Date(),
      })
      .where(eq(clients.id, existing.id));
    return existing.id;
  }

  /*
   * The insert can lose a race with itself, and `onConflictDoNothing` is what
   * makes losing survivable.
   *
   * The read above and this write are two statements, and `clients` carries a
   * unique index on `(shop_id, email)` and another on `(shop_id, phone)`. Two
   * orders from the same buyer at the same moment — a double-clicked "Buy
   * now", two open tabs, a retried request — both found nothing and both
   * inserted, and the loser got a raw Postgres 23505 that nothing caught. The
   * buyer's checkout died on an error page for having clicked twice.
   *
   * `onConflictDoNothing` with no target covers both indexes, which a
   * single-target `onConflictDoUpdate` cannot. An empty result then means the
   * other request won, so the row it wrote is read and updated — the same work
   * the `existing` branch above does, arrived at from the other direction.
   */
  const created = maybeRow(await db
    .insert(clients)
    .values({
      shopId,
      name: data.name ?? "Anonymous",
      email: data.email,
      phone: data.phone,
      ...address,
      marketingConsentAt: grantedConsent,
    })
    .onConflictDoNothing()
    .returning({ id: clients.id }));
  if (created) return created.id;

  const winner = await db.query.clients.findFirst({
    where: and(eq(clients.shopId, shopId), match),
  });
  // Nothing to conflict with and nothing to find is not a race — it is a row
  // this shop cannot hold, and the caller treats a null as "no client record".
  if (!winner) return null;

  await db
    .update(clients)
    .set({
      name: data.name ?? winner.name,
      email: data.email ?? winner.email,
      phone: data.phone ?? winner.phone,
      ...addressUpdate,
      // The twin of the grant-only merge above. A buyer who double-clicked
      // "Buy now" arrives here instead, and their consent must survive the
      // race exactly as it survives the ordinary path.
      marketingConsentAt: grantedConsent ?? winner.marketingConsentAt,
      updatedAt: new Date(),
    })
    .where(eq(clients.id, winner.id));
  return winner.id;
}

/**
 * Called from the public shop the moment a buyer commits. Persists the lead
 * first, then returns the next step for the rail they chose.
 */
