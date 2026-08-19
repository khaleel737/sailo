import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { member, organization, shops } from "@sailo/db/schema";
import { maybeRow } from "@sailo/core/invariant";

/**
 * Gives a shop a team, with its owner already inside it — spec 37.
 *
 * Called when a shop is created, and idempotent so a retry cannot leave a shop
 * with two organizations or a duplicate owner. `0052` does the same thing to
 * every shop that already existed; this is the same guarantee for every shop
 * made afterwards, and the two have to agree because `requireShop` reads the
 * result of both.
 *
 * A shop *without* one still loads: `requireShop` finds the owner through
 * `shops.userId` regardless. What it cannot do is have a second person in it —
 * which is exactly the right failure for the case where this did not run.
 *
 * Ids are minted here rather than by the plugin because the shop is created by
 * `createShop` and not by anybody calling the plugin's own endpoint. They are
 * `text` in the plugin's schema and opaque everywhere; a uuid is a fine one.
 */
export async function ensureShopOrganization(shopId: string): Promise<string | null> {
  const db = getDb();

  const shop = await db.query.shops.findFirst({
    where: eq(shops.id, shopId),
    columns: { id: true, name: true, userId: true, organizationId: true },
  });
  if (!shop) return null;
  if (shop.organizationId) {
    await ensureOwnerMember(shop.organizationId, shop.userId);
    return shop.organizationId;
  }

  /*
   * The slug is derived from the shop id rather than from its name, and it is
   * the same expression `0052`'s backfill uses. Two reasons: the plugin needs
   * it unique across the whole table, and nothing in Sailo ever shows it to
   * anybody — so a readable slug would be a collision risk bought for nothing.
   */
  const id = crypto.randomUUID();
  const created = maybeRow(
    await db
      .insert(organization)
      .values({
        id,
        name: shop.name,
        slug: `shop-${shop.id}`,
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: organization.id }),
  );

  /*
   * Losing the race is survivable: the slug is deterministic, so whoever won
   * created the organization this shop wants. Read it back rather than failing.
   */
  const organizationId =
    created?.id ??
    (
      await db.query.organization.findFirst({
        where: eq(organization.slug, `shop-${shop.id}`),
        columns: { id: true },
      })
    )?.id;
  if (!organizationId) return null;

  await db
    .update(shops)
    .set({ organizationId })
    .where(eq(shops.id, shop.id));
  await ensureOwnerMember(organizationId, shop.userId);

  return organizationId;
}

/** The owner's own membership. `ON CONFLICT DO NOTHING` on (org, user). */
async function ensureOwnerMember(organizationId: string, userId: string) {
  await getDb()
    .insert(member)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role: "owner",
      createdAt: new Date(),
    })
    .onConflictDoNothing();
}
