"use server";

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { shops } from "@/db/schema";
import { suppress } from "@/lib/broadcasts/audience";
import { readUnsubscribeToken } from "@/lib/broadcasts/unsubscribe";
import { rateLimit } from "@/lib/redis";
import { callerIp } from "@/lib/client-ip";

/**
 * The confirm page's button.
 *
 * Public and unauthenticated by necessity: somebody unsubscribing from a
 * marketing email has no account here and should not need one. All the
 * authority is in the token's signature.
 */

export type UnsubscribeState = {
  done: boolean;
  error?: string;
  /** The shop's name, so the page can say who they will stop hearing from. */
  shopName?: string;
};

export async function confirmUnsubscribe(
  _prev: UnsubscribeState,
  formData: FormData,
): Promise<UnsubscribeState> {
  const gate = await rateLimit(`unsub-form:${await callerIp()}`, 30, 60);
  if (!gate.allowed) {
    /*
     * Throttled is unknown, never a negative answer and never a false
     * positive. Saying "done" here would be the worst of both: the person
     * walks away believing they are off the list, and the next broadcast
     * proves otherwise.
     */
    return { done: false, error: "Too many attempts — try again in a minute." };
  }

  const claim = readUnsubscribeToken(String(formData.get("token") ?? ""));
  if (!claim) return { done: false, error: "That link isn't valid any more." };

  const shop = await getDb().query.shops.findFirst({
    where: eq(shops.id, claim.shopId),
    columns: { name: true },
  });
  if (!shop) return { done: false, error: "That link isn't valid any more." };

  await suppress({
    shopId: claim.shopId,
    email: claim.email,
    reason: "unsubscribed",
  });

  return { done: true, shopName: shop.name };
}
