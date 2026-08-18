/**
 * What every HQ action does before and after the thing it came to do.
 *
 * Load the shop or the account named by the form, and write a staff note recording who did
 * what. Four helpers, shared by the three action modules beside this one.
 *
 * WHY THIS FILE HAS NO `"use server"`
 *
 * Deliberately. A server module's exports become *callable endpoints* — anything exported from
 * one is reachable from a browser. `loadAccount` takes an account id out of a form and returns
 * the row; exported from a server module it would be an unauthenticated read of any account by
 * id. These are internal, so they live somewhere that cannot accidentally publish them.
 */

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops, staffActions, user as userTable, type Shop } from "@sailo/db/schema";
import { publishShopEvent } from "@sailo/events";
import { requireStaff } from "@/lib/session";
import { revalidateShopOnWeb } from "@/lib/web-cache";


/* ===========================================================================
   What staff may do to someone else's account.

   Everything else in /hq is read-only, and that is the intended balance: this
   panel exists to understand the business, not to operate sellers' shops for
   them. What is here is what support genuinely needs — grant a plan, take an
   abusive shop down, get an account back from whoever has taken it — and every
   one of them writes a row to `staff_actions` before it returns.

   The split below is deliberate. The first group acts on a *shop*: entitlements
   and visibility, which change what the public storefront renders, so each one
   busts the storefront cache on its way out. The second acts on a *person*:
   sessions, second factors, credentials. Those exist because the alternative to
   staff being able to sign a stolen account out is telling its owner to wait.
=========================================================================== */

export async function loadShop(formData: FormData) {
  const staff = await requireStaff();

  const shopId = String(formData.get("shopId") ?? "").trim();
  if (!shopId) return { staff, shop: null } as const;

  const shop = await getDb().query.shops.findFirst({
    where: eq(shops.id, shopId),
  });
  return { staff, shop: shop ?? null } as const;
}

export async function record(
  actorEmail: string,
  action: string,
  shop: Shop,
  summary: string,
) {
  await getDb().insert(staffActions).values({
    actorEmail,
    action,
    shopId: shop.id,
    summary,
  });

  /*
   * Entitlements and visibility both change what the public storefront
   * renders, and the storefront is cached until a write says otherwise. Busting
   * the tag here rather than in each caller means no staff action can ship a
   * change that only takes effect the next time the seller happens to edit
   * something.
   *
   * The storefront is in *another deployment* now, so this is an HTTP call
   * rather than a cache write — see `lib/web-cache.ts`. The semantics are kept
   * exactly: apps/web expires the tag outright rather than serving one more
   * stale request, because a staff action is enforcement, and enforcement that
   * lets one more request through isn't enforcement.
   *
   * Awaited, unlike the seller-panel ping below. A suspension that has not yet
   * reached the storefront cache is a suspension that has not taken effect, and
   * the staff member clicking it should not be told it is done before it is.
   */
  await revalidateShopOnWeb({ id: shop.id, handle: shop.handle });
  revalidatePath(`/accounts/${shop.userId}`);
  revalidatePath("/accounts");
  revalidatePath("/revenue");
  revalidatePath("/");

  /*
   * Enforcement lands on the seller's screen as it lands on their account: a
   * suspension banner, a granted plan, a staff note. The seller's panel is
   * the audience the paths above can't reach, being another user's session.
   */
  after(() => publishShopEvent(shop.id, "account"));
}

/**
 * The audit row for an action about a *person* rather than their shop.
 *
 * `record()` above also busts the storefront cache and pings the seller's
 * panel, because entitlements and suspensions change what the public page
 * renders. Signing a device out changes nothing a visitor can see, so this
 * writes the row and refreshes the two staff screens that show it — and
 * nothing else.
 */
export async function recordOnAccount(
  actorEmail: string,
  action: string,
  shopId: string | null,
  ownerId: string,
  summary: string,
) {
  await getDb().insert(staffActions).values({
    actorEmail,
    action,
    shopId,
    summary,
  });

  revalidatePath(`/accounts/${ownerId}`);
  revalidatePath("/security");
}

/** The account an action names, with the shop it owns if there is one. */
export async function loadAccount(formData: FormData) {
  const staff = await requireStaff();
  const db = getDb();

  const userId = String(formData.get("userId") ?? "").trim();
  if (!userId) return { staff, owner: null, shopId: null } as const;

  const owner = await db.query.user.findFirst({
    where: eq(userTable.id, userId),
    columns: { id: true, name: true, email: true, twoFactorEnabled: true },
  });
  if (!owner) return { staff, owner: null, shopId: null } as const;

  const shop = await db.query.shops.findFirst({
    where: eq(shops.userId, owner.id),
    columns: { id: true },
  });

  return { staff, owner, shopId: shop?.id ?? null } as const;
}
