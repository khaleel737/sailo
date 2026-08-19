"use server";

import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { automations, shops } from "@sailo/db/schema";
import { suppress } from "@sailo/marketing/broadcasts/server";
import { readUnsubscribeToken } from "@sailo/marketing/broadcasts/server";
import { optOut } from "@sailo/marketing/lifecycle/server";
import { readMarketingOptOutToken } from "@sailo/marketing/lifecycle/server";
import {
  optOutOfAutomation,
  readAutomationUnsubToken,
} from "@sailo/marketing/automations/server";
import { rateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";

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

/**
 * The same button, for Sailo's own marketing rather than a shop's.
 *
 * Beside its twin because the two are read together and their differences are
 * the interesting part: no shop to resolve, so no lookup and no way for the
 * answer to depend on whether a row exists; a platform-wide opt-out rather
 * than a shop-scoped suppression; and a separate signing domain, so a token
 * from the other flow fails the signature check here instead of quietly
 * unsubscribing somebody from the wrong list.
 *
 * Public and unauthenticated by necessity — somebody leaving a mailing list
 * should not have to sign in to do it, and the person clicking may have
 * forgotten the account exists. All the authority is in the signature.
 */
export async function confirmMarketingUnsubscribe(
  _prev: UnsubscribeState,
  formData: FormData,
): Promise<UnsubscribeState> {
  const gate = await rateLimit(`unsub-mkt-form:${await callerIp()}`, 30, 60);
  if (!gate.allowed) {
    // Throttled is unknown, never a negative answer — and never a false
    // positive. Saying "done" here would be the worst of both: they walk away
    // believing they are off the list, and the next email proves otherwise.
    return { done: false, error: "Too many attempts — try again in a minute." };
  }

  const claim = readMarketingOptOutToken(String(formData.get("token") ?? ""));
  if (!claim) return { done: false, error: "That link isn't valid any more." };

  await optOut({ email: claim.email, reason: "unsubscribed" });

  return { done: true };
}


/**
 * The same button, for one flow — spec 30.
 *
 * Its own action rather than a parameter on the one above, because the two
 * write different things: that one suppresses an address for a whole shop and
 * this one stops a single sequence and touches no list. Putting "which kind"
 * in a parameter would put it in the request, which is exactly where a replay
 * would want it.
 *
 * The person is told what did *not* happen, and that is the part worth getting
 * right: leaving one sequence is not leaving the shop's list, and somebody who
 * meant the second and got the first will be surprised by the next campaign.
 */
export async function confirmFlowUnsubscribe(
  _prev: UnsubscribeState,
  formData: FormData,
): Promise<UnsubscribeState> {
  const gate = await rateLimit(`unsub-flow-form:${await callerIp()}`, 30, 60);
  if (!gate.allowed) {
    // Throttled is unknown, never a false positive: somebody told "done" who
    // is not done walks away and the next email in the sequence proves it.
    return { done: false, error: "Too many attempts — try again in a minute." };
  }

  const claim = readAutomationUnsubToken(String(formData.get("token") ?? ""));
  if (!claim) return { done: false, error: "That link isn't valid any more." };

  const automation = await getDb().query.automations.findFirst({
    where: eq(automations.id, claim.automationId),
    columns: { name: true },
  });
  if (!automation) return { done: false, error: "That link isn't valid any more." };

  await optOutOfAutomation(claim);

  return { done: true, shopName: automation.name };
}
