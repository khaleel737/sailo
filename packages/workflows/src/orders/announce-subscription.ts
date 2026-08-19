import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { clients, subscriptions, type Shop } from "@sailo/db/schema";
import { emitSubscriptionWebhook } from "@sailo/webhooks/emit";
import type { WebhookEvent } from "@sailo/webhooks/events";
import { enrolIfMatching } from "@sailo/marketing/automations/server";

/**
 * A subscription changed: tell the seller's integrations, and start any
 * scenario waiting for it.
 *
 * The twin of `announce-paid`, and it exists for the same reason: there are
 * five places a subscription's state moves, and spec 31's triggers would
 * otherwise have to be added at each of them. One function is one place to
 * forget rather than five.
 *
 * These four triggers are **scenario-only**. Spec 31's own examples live here
 * — *"3 days after subscription expiration, remove the customer from the
 * community"* — and an email flow has no use for them, so `kinds` names the
 * one that does. A flow listening for `subscription.expired` would be a row
 * whose trigger its own vocabulary does not contain, which `triggerMatches`
 * refuses anyway; naming the kind here means it is never even considered.
 */
export async function announceSubscriptionEvent(input: {
  shop: Shop;
  event: WebhookEvent;
  subscriptionId: string;
}): Promise<void> {
  const { shop, event, subscriptionId } = input;

  /*
   * The webhook first, and unconditionally: it is the promise with a consumer
   * on the other end, and a failure in our own enrolment must not swallow it.
   */
  await emitSubscriptionWebhook({ shop, event, subscriptionId });

  /*
   * Scenario triggers only, and only the four this vocabulary knows. An event
   * outside it — `subscription.cancelled`, say — emits its webhook above and
   * enrols nothing, which is correct: a trigger with no picker entry is a
   * trigger no seller could have configured.
   */
  if (!event.startsWith("subscription.")) return;

  const row = await getDb().query.subscriptions.findFirst({
    where: eq(subscriptions.id, subscriptionId),
    columns: { id: true, shopId: true, clientId: true },
  });
  if (!row || row.shopId !== shop.id) return;

  /*
   * The member's address, from the client the subscription belongs to.
   *
   * A run is identified by an address, so a subscription with no client behind
   * it — which a manual membership can be — enrols nothing. Not an error: a
   * scenario's actions are all addressed to somebody, and there is nobody.
   */
  if (!row.clientId) return;
  const client = await getDb().query.clients.findFirst({
    where: eq(clients.id, row.clientId),
    columns: { email: true },
  });
  if (!client?.email) return;

  await enrolIfMatching({
    shopId: shop.id,
    trigger: event,
    subject: { email: client.email.toLowerCase(), clientId: row.clientId },
    context: { subscriptionId },
    kinds: ["scenario"],
  });
}
