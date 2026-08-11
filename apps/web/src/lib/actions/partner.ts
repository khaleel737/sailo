"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { affiliates, shops } from "@sailo/db/schema";
import { newPortalToken, portalLinksForEmail, portalUrl } from "@/lib/affiliate-portal";
import {
  PAYOUT_METHOD_LABELS,
  isPayoutMethodType,
  maskPayoutDetails,
} from "@/lib/payouts";
import { sendPayoutDetailsChanged, sendPortalLinks } from "@/lib/email";
import { publishAffiliateEvent, publishShopEvent } from "@/lib/events";
import { rateLimit, refundRateLimit } from "@/lib/redis";
import { callerIp } from "@/lib/client-ip";
import type { ActionState } from "./shop";

/**
 * Emails an affiliate their private report links.
 *
 * Always answers the same way. Telling an anonymous visitor whether an address
 * is registered would turn this box into a way to find out who promotes a
 * shop, which is nobody's business but theirs.
 */
export async function requestPortalLink(email: string): Promise<{ ok: true }> {
  /*
   * Sends mail to an address the caller chooses, which makes an unthrottled
   * version two things at once: a way to flood someone's inbox, and a way to
   * spend the sending quota. The answer stays `ok` either way — saying "rate
   * limited" to one address and "ok" to another would leak exactly what the
   * constant reply is here to hide.
   */
  const gate = await rateLimit(`portal:${await callerIp()}`, 5, 900);
  if (!gate.allowed) return { ok: true };

  const address = email.trim().toLowerCase();
  if (address.includes("@") && address.length < 200) {
    const links = await portalLinksForEmail(address);
    if (links.length > 0) {
      const result = await sendPortalLinks({ to: address, links });
      if (!result.sent) {
        console.warn(`[sailo] portal link email not sent: ${result.reason}`);
      }
    }
  }
  return { ok: true };
}

/**
 * The affiliate telling the seller where their commission should go.
 *
 * The portal token is the whole credential — affiliates have no account — so
 * this action is honest about what that means: it takes the token from the
 * form, looks the affiliate up by it, and treats possession as authority. The
 * two guards around that are the rate limit below, which keeps the lookup from
 * doubling as a token brute-forcer, and the email in the middle, which makes
 * sure a change made with a stolen link is never a silent one.
 */
export async function savePayoutDetails(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  /*
   * The budget is for guessing tokens, so it charges misses, not use: pay up
   * front (the atomic INCR is the verdict), refund once the token turns out
   * to be real. An affiliate correcting a typo twice costs nothing; ten
   * invalid tokens from one connection ends the guessing for the window.
   */
  const gate = await rateLimit(`portal-write:${await callerIp()}`, 10, 900);
  if (!gate.allowed) {
    return { ok: false, error: "Too many attempts — try again in a few minutes." };
  }

  const token = String(formData.get("token") ?? "").trim();
  const method = String(formData.get("method") ?? "").trim();
  const details = String(formData.get("details") ?? "").trim().slice(0, 300);

  if (!token || !isPayoutMethodType(method)) {
    return { ok: false, error: "Something went wrong. Reload the page and try again." };
  }
  if (!details) {
    return { ok: false, error: "Add the details for how you'd like to be paid." };
  }

  const db = getDb();
  const affiliate = await db.query.affiliates.findFirst({
    where: eq(affiliates.portalToken, token),
  });
  if (!affiliate) {
    // Rotated or never real — either way the page they're on is stale.
    return { ok: false, error: "This link isn't valid any more. Reload the page." };
  }
  await refundRateLimit(`portal-write:${await callerIp()}`, 900);

  // Saving what's already saved is not a change: no write, no alarm email.
  if (affiliate.payoutMethod === method && affiliate.payoutDetails === details) {
    return { ok: true };
  }

  const now = new Date();
  await db
    .update(affiliates)
    .set({
      payoutMethod: method,
      payoutDetails: details,
      payoutUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(affiliates.id, affiliate.id));

  // Best effort, like the welcome mail — the save stands either way, but a
  // failure to warn is worth a line in the logs.
  if (affiliate.email) {
    const shop = await db.query.shops.findFirst({
      where: eq(shops.id, affiliate.shopId),
      columns: { name: true },
    });
    const result = await sendPayoutDetailsChanged({
      to: affiliate.email,
      shopName: shop?.name ?? "your shop",
      methodLabel: PAYOUT_METHOD_LABELS[method],
      maskedDetails: maskPayoutDetails(details),
      portalUrl: portalUrl(token),
    });
    if (!result.sent) {
      console.warn(`[sailo] payout change email not sent: ${result.reason}`);
    }
  }

  revalidatePath(`/partner/${token}`);
  // The seller reads these details next to what they owe.
  revalidatePath("/admin/affiliates");
  after(() => publishShopEvent(affiliate.shopId, "affiliate"));
  after(() => publishAffiliateEvent(affiliate.id, "affiliate"));
  return { ok: true };
}

/**
 * Swaps the portal token for a fresh one and lands the caller on the new URL.
 *
 * This is the affiliate's kill switch for a leaked link: every copy of the old
 * URL — forwarded chats, browser history on a shared machine, whatever the
 * seller pasted somewhere — stops working the moment this runs. The new link
 * is also emailed to the address on file, which cuts both ways on purpose: an
 * affiliate resetting their own link gets a durable copy, and an attacker
 * resetting a stolen one hands the real owner the new key.
 */
export async function rotatePortalToken(formData: FormData): Promise<void> {
  // Same budget and same charge-misses shape as the save above: the two
  // actions are the same lookup as far as a token-guesser is concerned.
  const gate = await rateLimit(`portal-write:${await callerIp()}`, 10, 900);
  if (!gate.allowed) return;

  const token = String(formData.get("token") ?? "").trim();
  if (!token) return;

  const db = getDb();
  const affiliate = await db.query.affiliates.findFirst({
    where: eq(affiliates.portalToken, token),
  });
  if (!affiliate) return;
  await refundRateLimit(`portal-write:${await callerIp()}`, 900);

  const fresh = newPortalToken();
  await db
    .update(affiliates)
    .set({ portalToken: fresh, updatedAt: new Date() })
    .where(eq(affiliates.id, affiliate.id));

  if (affiliate.email) {
    const shop = await db.query.shops.findFirst({
      where: eq(shops.id, affiliate.shopId),
      columns: { name: true },
    });
    const result = await sendPortalLinks({
      to: affiliate.email,
      links: [{ shopName: shop?.name ?? "your shop", url: portalUrl(fresh) }],
    });
    if (!result.sent) {
      console.warn(`[sailo] rotated portal link email not sent: ${result.reason}`);
    }
  }

  /*
   * The kill switch should reach live viewers too: any other open copy of
   * the old link refreshes on this hint, asks with a token that no longer
   * resolves, and lands on the 404 that is now the truth — instead of
   * keeping a stale report readable until someone reloads it by hand.
   */
  after(() => publishAffiliateEvent(affiliate.id, "affiliate"));
  redirect(`/partner/${fresh}?reset=1`);
}
