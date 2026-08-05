import "server-only";
import { and, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { clients } from "@/db/schema";
import { firstRow } from "@/lib/invariant";

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
) {
  const db = getDb();
  if (!data.email && !data.phone) return null;

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
        updatedAt: new Date(),
      })
      .where(eq(clients.id, existing.id));
    return existing.id;
  }

  const created = firstRow(await db
    .insert(clients)
    .values({
      shopId,
      name: data.name ?? "Anonymous",
      email: data.email,
      phone: data.phone,
      ...address,
    })
    .returning({ id: clients.id }), "created");
  return created.id;
}

/**
 * Called from the public shop the moment a buyer commits. Persists the lead
 * first, then returns the next step for the rail they chose.
 */
