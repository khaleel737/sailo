"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  apiKeys,
  clients,
  orderItems,
  orders,
  webhookDeliveries,
  webhookEndpoints,
} from "@sailo/db/schema";
import { requireShop } from "@/lib/session";
import { maybeRow } from "@sailo/core/invariant";
import { can, cheapestPlanWith, upgradeMessage } from "@sailo/core/plans";
import { rateLimit } from "@sailo/rate-limit";
import { isApiScope, mintApiKey } from "@sailo/api/rest";
import { orderResource, sampleOrderResource } from "@sailo/core/resources";
import {
  MAX_API_KEYS_PER_SHOP,
  MAX_ENDPOINTS_PER_SHOP,
  envelope,
  knownEvents,
} from "@sailo/webhooks/events";
import { isWebhookTargetUrl } from "@sailo/webhooks/post";
import { newWebhookSecret } from "@sailo/webhooks/signature";
import type { Shop } from "@sailo/db/schema";

/**
 * The Integrations tab's writes: endpoints, keys, and the test send.
 *
 * Two rules run through all of them.
 *
 * **A secret is returned exactly once, in the action's own result.** Creating
 * an endpoint or a key hands the plaintext back through `ActionState`, the
 * card renders it, and it is gone on the next navigation. Nothing stores it in
 * a cookie, a search param or the page's data — a secret that survives a
 * refresh is one that survives a screenshot, a shared screen, and a browser
 * history somebody else opens.
 *
 * **Every write re-checks the plan and the ownership.** `requireShop` gives
 * the session's shop and every WHERE carries its id, so an id belonging to
 * another seller matches nothing rather than being refused — the difference
 * matters, because a refusal is an answer about a row that exists.
 */

export type IntegrationState = {
  ok: boolean;
  error?: string;
  message?: string;
  /** Rendered once and never again — the endpoint secret or the API token. */
  secret?: string;
};

const failed = (error: string): IntegrationState => ({ ok: false, error });

/** The gate, once, in the shape every action here needs it. */
function gate(shop: Shop): IntegrationState | null {
  if (can(shop, "integrations")) return null;
  const plan = cheapestPlanWith("integrations");
  return failed(
    plan
      ? upgradeMessage("integrations", "Webhooks and the API")
      : "Integrations aren't available on your plan.",
  );
}

function refresh() {
  revalidatePath("/admin/settings/integrations");
}

/* -------------------------------------------------------------------------- */
/*  Endpoints                                                                  */
/* -------------------------------------------------------------------------- */

/** The events ticked on the form, filtered to ones we actually emit. */
function eventsFrom(formData: FormData): string[] {
  return knownEvents(formData.getAll("events").map(String));
}

export async function createWebhookEndpoint(
  _prev: IntegrationState,
  formData: FormData,
): Promise<IntegrationState> {
  const { shop } = await requireShop();
  const denied = gate(shop);
  if (denied) return denied;

  const url = String(formData.get("url") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim().slice(0, 80) || null;
  const events = eventsFrom(formData);

  /*
   * The URL is refused here as well as at delivery time, and the two checks
   * are not redundant. This one exists so the seller is told at the form —
   * `isWebhookTargetUrl` is the same predicate the POST applies, so a URL that
   * saves is one that will actually be attempted, and the alternative is a
   * silent endpoint whose only symptom is a delivery log full of refusals.
   */
  if (!isWebhookTargetUrl(url)) {
    return failed(
      "That needs to be an https:// address on port 443, on a public host.",
    );
  }
  if (events.length === 0) {
    return failed("Tick at least one event, or nothing will ever be sent.");
  }

  const db = getDb();

  const [existing] = await db
    .select({ total: count() })
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.shopId, shop.id));
  if ((existing?.total ?? 0) >= MAX_ENDPOINTS_PER_SHOP) {
    return failed(
      `You can have ${MAX_ENDPOINTS_PER_SHOP} endpoints. Delete one to add another.`,
    );
  }

  const secret = newWebhookSecret();

  /*
   * `onConflictDoNothing` against `(shop_id, url)`. An empty result is the
   * double-submit the unique index exists to absorb, and saying "you already
   * have one" is more useful than a raw 23505 on a form.
   */
  const created = maybeRow(
    await db
      .insert(webhookEndpoints)
      .values({ shopId: shop.id, url, label, secret, events })
      .onConflictDoNothing()
      .returning({ id: webhookEndpoints.id }),
  );

  if (!created) return failed("You already have an endpoint pointing at that URL.");

  refresh();
  return {
    ok: true,
    message: "Endpoint added. Copy the signing secret now — it isn't shown again.",
    secret,
  };
}

export async function updateWebhookEndpoint(
  _prev: IntegrationState,
  formData: FormData,
): Promise<IntegrationState> {
  const { shop } = await requireShop();
  const denied = gate(shop);
  if (denied) return denied;

  const id = String(formData.get("id") ?? "");
  const events = eventsFrom(formData);
  if (!id) return failed("Nothing to update.");
  if (events.length === 0) {
    return failed("Tick at least one event, or nothing will ever be sent.");
  }

  const isActive = formData.get("isActive") === "on";

  const updated = maybeRow(
    await getDb()
      .update(webhookEndpoints)
      .set({
        label: String(formData.get("label") ?? "").trim().slice(0, 80) || null,
        events,
        isActive,
        /*
         * Switching an endpoint back on clears both the reason and the count.
         *
         * Leaving `failureCount` at twenty would auto-disable it again on its
         * very next failure, which is not a second chance — it is the same
         * dead end with an extra click in front of it.
         */
        ...(isActive ? { failureCount: 0, disabledReason: null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.shopId, shop.id)))
      .returning({ id: webhookEndpoints.id }),
  );

  if (!updated) return failed("That endpoint no longer exists.");

  refresh();
  return { ok: true, message: "Saved." };
}

export async function rotateWebhookSecret(
  _prev: IntegrationState,
  formData: FormData,
): Promise<IntegrationState> {
  const { shop } = await requireShop();
  const denied = gate(shop);
  if (denied) return denied;

  const id = String(formData.get("id") ?? "");
  if (!id) return failed("Nothing to rotate.");

  const secret = newWebhookSecret();
  const updated = maybeRow(
    await getDb()
      .update(webhookEndpoints)
      .set({ secret, updatedAt: new Date() })
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.shopId, shop.id)))
      .returning({ id: webhookEndpoints.id }),
  );

  if (!updated) return failed("That endpoint no longer exists.");

  refresh();
  return {
    ok: true,
    /*
     * Blunt, because the cut-over is immediate and there is no overlap window:
     * the very next delivery is signed with the new secret, so a consumer
     * still holding the old one will start rejecting messages as forgeries.
     */
    message:
      "Rotated. Update your endpoint now — the next event is signed with this secret.",
    secret,
  };
}

export async function deleteWebhookEndpoint(formData: FormData): Promise<void> {
  const { shop } = await requireShop();
  // Not plan-gated, unlike creation: turning an endpoint off is how a seller
  // stops it, and a seller whose plan lapsed still needs to be able to. The
  // ownership check in the WHERE is the only guard that belongs here.

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Deliveries go with it, by the cascade on `endpoint_id`.
  await getDb()
    .delete(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.shopId, shop.id)));

  refresh();
}

/* -------------------------------------------------------------------------- */
/*  The test send                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Queues one test delivery, carrying the shop's most recent order.
 *
 * **A real order rather than a made-up one, when there is one**, because of
 * what the button is actually for: Zapier's Catch Hook builds its whole field
 * map from the first payload it receives, and a sample full of `"string"` and
 * `0` produces a Zap wired to nothing. A seller who tests with fabricated data
 * and maps against it discovers the mismatch on their first real sale.
 *
 * The envelope's `test` flag is true either way, so a consumer that cares can
 * ignore it — and `docs` tells them to.
 */
export async function sendTestWebhook(
  _prev: IntegrationState,
  formData: FormData,
): Promise<IntegrationState> {
  const { shop } = await requireShop();
  const denied = gate(shop);
  if (denied) return denied;

  const id = String(formData.get("id") ?? "");
  if (!id) return failed("Nothing to test.");

  /*
   * A ceiling, because this is a button that makes our servers POST to an
   * address the seller chose. Without one it is a request amplifier pointed at
   * whoever they name, driven by a click.
   */
  const budget = await rateLimit(`webhook-test:${shop.id}`, 10, 300);
  if (!budget.allowed) {
    return failed("That's a lot of test events. Wait a few minutes.");
  }

  const db = getDb();
  const endpoint = await db.query.webhookEndpoints.findFirst({
    where: and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.shopId, shop.id)),
  });
  if (!endpoint) return failed("That endpoint no longer exists.");
  if (!endpoint.isActive) {
    return failed("Switch the endpoint back on first — a disabled one isn't sent to.");
  }

  const latest = await db.query.orders.findFirst({
    where: eq(orders.shopId, shop.id),
    orderBy: [desc(orders.createdAt)],
  });

  const items = latest
    ? await db.query.orderItems.findMany({
        where: eq(orderItems.orderId, latest.id),
        orderBy: [asc(orderItems.position)],
      })
    : [];

  const deliveryId = randomUUID();
  const now = new Date();

  await db.insert(webhookDeliveries).values({
    id: deliveryId,
    endpointId: endpoint.id,
    shopId: shop.id,
    event: "order.created",
    payload: envelope({
      id: deliveryId,
      event: "order.created",
      shop,
      data: latest ? orderResource(latest, items) : sampleOrderResource(shop),
      now,
      test: true,
    }),
    status: "pending",
    nextAttemptAt: now,
  });

  refresh();
  return {
    ok: true,
    message: latest
      ? "Test queued with your most recent order. It'll arrive within five minutes."
      : "Test queued with a sample order — you have no real ones yet. It'll arrive within five minutes.",
  };
}

/* -------------------------------------------------------------------------- */
/*  API keys                                                                   */
/* -------------------------------------------------------------------------- */

export async function createApiKey(
  _prev: IntegrationState,
  formData: FormData,
): Promise<IntegrationState> {
  const { shop } = await requireShop();
  const denied = gate(shop);
  if (denied) return denied;

  const label = String(formData.get("label") ?? "").trim().slice(0, 60);
  if (!label) return failed("Give the key a name, so you know what to revoke later.");

  /*
   * Write is a deliberate extra tick, and the default is read.
   *
   * The form sends `scopes` only for boxes that are ticked, so a caller
   * omitting it entirely gets a read-only key — which is the safe direction
   * for a field that decides whether a program can change a seller's data.
   */
  const scopes = formData.getAll("scopes").map(String).filter(isApiScope);
  /*
   * Read is always present, even if the form somehow omits it. A key with no
   * scopes at all would authenticate and then refuse everything, which reads
   * to a seller as "the API is broken" rather than as a configuration they got
   * wrong.
   */
  const granted = scopes.includes("read") ? scopes : ["read", ...scopes];

  const db = getDb();
  const [existing] = await db
    .select({ total: count() })
    .from(apiKeys)
    .where(and(eq(apiKeys.shopId, shop.id), isNull(apiKeys.revokedAt)));
  if ((existing?.total ?? 0) >= MAX_API_KEYS_PER_SHOP) {
    return failed(`You can have ${MAX_API_KEYS_PER_SHOP} live keys. Revoke one first.`);
  }

  const minted = mintApiKey();
  await db.insert(apiKeys).values({
    shopId: shop.id,
    label,
    prefix: minted.prefix,
    tokenHash: minted.tokenHash,
    scopes: granted,
  });

  refresh();
  return {
    ok: true,
    message: "Key created. Copy it now — this is the only time it's shown.",
    secret: minted.token,
  };
}

export async function revokeApiKey(formData: FormData): Promise<void> {
  const { shop } = await requireShop();
  // Not plan-gated, unlike minting: revoking is the answer to a leak, and a
  // seller whose plan lapsed must still be able to turn a live key off rather
  // than leave it working because they stopped paying. Ownership is enforced
  // in the WHERE below.

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  /*
   * Stamped, not deleted, and only if it is not already revoked — so the
   * timestamp records the first revocation rather than the last time somebody
   * pressed the button. "When did we turn that key off" is the question asked
   * after a leak, and it has one right answer.
   */
  await getDb()
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, id),
        eq(apiKeys.shopId, shop.id),
        isNull(apiKeys.revokedAt),
      ),
    );

  refresh();
}

/* -------------------------------------------------------------------------- */
/*  Reads for the page                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Everything the Integrations tab renders, in one call.
 *
 * A server action rather than a query in the page so the card can re-read
 * after a mutation without the page re-rendering everything else — and, more
 * importantly, so `secret` and `tokenHash` are named nowhere in what reaches
 * the client. The select lists columns explicitly for exactly that reason: a
 * `select()` with no argument would ship both.
 */
export async function readIntegrations() {
  const { shop } = await requireShop();
  const db = getDb();

  const endpoints = await db
    .select({
      id: webhookEndpoints.id,
      url: webhookEndpoints.url,
      label: webhookEndpoints.label,
      events: webhookEndpoints.events,
      isActive: webhookEndpoints.isActive,
      disabledReason: webhookEndpoints.disabledReason,
      failureCount: webhookEndpoints.failureCount,
      lastAttemptAt: webhookEndpoints.lastAttemptAt,
      lastStatus: webhookEndpoints.lastStatus,
      lastResponseStatus: webhookEndpoints.lastResponseStatus,
      createdAt: webhookEndpoints.createdAt,
    })
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.shopId, shop.id))
    .orderBy(asc(webhookEndpoints.createdAt));

  const keys = await db
    .select({
      id: apiKeys.id,
      label: apiKeys.label,
      prefix: apiKeys.prefix,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.shopId, shop.id), isNull(apiKeys.revokedAt)))
    .orderBy(asc(apiKeys.createdAt));

  const recent = await db
    .select({
      id: webhookDeliveries.id,
      event: webhookDeliveries.event,
      status: webhookDeliveries.status,
      attempt: webhookDeliveries.attempt,
      responseStatus: webhookDeliveries.responseStatus,
      error: webhookDeliveries.error,
      createdAt: webhookDeliveries.createdAt,
      deliveredAt: webhookDeliveries.deliveredAt,
    })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.shopId, shop.id))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(20);

  /*
   * Counted rather than listed. The card says "you have 412 contacts an
   * integration can read", which is the number a seller wants when deciding
   * whether to grant a key, and listing them here would be a second copy of a
   * screen that already exists.
   */
  const [contactCount] = await db
    .select({ total: count() })
    .from(clients)
    .where(eq(clients.shopId, shop.id));

  return {
    endpoints,
    keys,
    recent,
    contactCount: contactCount?.total ?? 0,
  };
}
