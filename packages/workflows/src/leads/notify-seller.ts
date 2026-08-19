import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { user, type Shop } from "@sailo/db/schema";
import { rateLimit } from "@sailo/rate-limit";
import { wantsNotification } from "@sailo/notifications/prefs";
import { sendSellerLead } from "@sailo/email/shop";

/**
 * Telling a seller somebody left their details.
 *
 * Same contract as every other seller notification: the thing being reported
 * has already happened, so a mail provider having a bad afternoon must never
 * fail it. Every failure is logged and swallowed.
 *
 * The ceiling is per shop per day, like the order one, and it exists for a
 * reason specific to this feature: a lead form is the most farmable endpoint
 * in the product. `captureLead` bounds submissions per address and per caller,
 * but a distributed run of a thousand real addresses is a thousand legitimate
 * leads — and a thousand emails to one seller, out of the same Resend quota
 * that carries every other shop's receipts.
 */
const DAILY_CEILING = 200;

/** Reported once per instance per shop, so a burst logs a line and not a wall. */
const ceilingLogged = new Set<string>();

export async function notifySellerOfLead(opts: {
  shop: Shop;
  productTitle: string;
  email: string;
  name: string | null;
}): Promise<void> {
  try {
    const { shop } = opts;
    if (!wantsNotification(shop.notificationPrefs, "leadCaptured")) return;

    /*
     * DECISION B — deliberately stays open, like the order notification it
     * copies. A cache outage that silenced every seller's alerts would be a
     * worse day than the quota risk it removes, and this ceiling is a backstop
     * against a bug rather than against a caller — the caller is already
     * bounded twice, before anything is written.
     */
    const gate = await rateLimit(`seller-lead-mail:${shop.id}`, DAILY_CEILING, 86_400);
    if (!gate.allowed) {
      if (!ceilingLogged.has(shop.id)) {
        ceilingLogged.add(shop.id);
        console.error(
          `[sailo] lead notification ceiling hit for shop ${shop.id} — ` +
            `suppressing further lead mail today`,
        );
      }
      return;
    }

    const to = await sellerAddress(shop);
    if (!to) return;

    await sendSellerLead({
      shopName: shop.name,
      to,
      productTitle: opts.productTitle,
      leadEmail: opts.email,
      leadName: opts.name,
    });
  } catch (error) {
    console.error("[sailo] could not tell the seller about a lead", error);
  }
}

/** `notificationEmail`, then `contactEmail`, then the account's own address. */
async function sellerAddress(shop: Shop): Promise<string | null> {
  if (shop.notificationEmail) return shop.notificationEmail;
  if (shop.contactEmail) return shop.contactEmail;
  const owner = await getDb().query.user.findFirst({
    where: eq(user.id, shop.userId),
    columns: { email: true },
  });
  return owner?.email ?? null;
}
