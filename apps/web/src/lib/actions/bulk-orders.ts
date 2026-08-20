"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { inArray, and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orders } from "@sailo/db/schema";
import { publishShopEvent } from "@sailo/events";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { isUuid } from "@sailo/core/uuid";
import { awaitsTransfer } from "@sailo/core/payment-status";
import {
  changeOrderStatus,
  setPaymentStatus as pay,
  shipOrder as ship,
} from "@sailo/commerce/orders/server";
import { sendDownloadReady } from "@sailo/email/transactional";
import { sendShippingNotification } from "@/lib/email";
import { arrivalUrl, logOrderMessage } from "@sailo/commerce/disputes";
import { announceOrderPaid } from "@sailo/workflows/orders";
import type { ActionState } from "./shop";

/**
 * The selection bar's writers — every one a loop over the *same* commerce
 * function its single-order button calls, never a bare UPDATE over the ids.
 * That is the whole design: confirming a payment unlocks downloads, extends
 * memberships and emails buyers, and a bulk door that skipped any of it
 * would be the "guard at one sink and not its twin" bug shape, fifty rows at
 * a time.
 *
 * Every id is re-read against the shop before anything runs — a POST body is
 * a claim — and ineligible rows are *counted*, not silently dropped: the bar
 * reports "3 updated · 2 skipped" because a number that quietly shrank reads
 * as "done" when it wasn't.
 */

/** The ids, deduped, uuid-checked, and capped at the list page's own size. */
function readIds(formData: FormData): string[] {
  const ids = [...new Set(formData.getAll("ids").map(String))].filter(isUuid);
  return ids.slice(0, 100);
}

/**
 * "{done} updated · {skipped} skipped" — or the plain half when one is 0.
 * Takes the two resolved strings rather than the section, so every call site
 * names its keys where the usage scan can see them.
 */
function tally(
  done: number,
  skipped: number,
  doneTemplate: string,
  skippedTemplate: string,
): string {
  const parts = [
    interpolate(doneTemplate, { done: done.toLocaleString() }),
    skipped > 0
      ? interpolate(skippedTemplate, { skipped: skipped.toLocaleString() })
      : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

/** The selected rows that actually belong to this shop, whole. */
async function ownRows(shopId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return getDb().query.orders.findMany({
    where: and(eq(orders.shopId, shopId), inArray(orders.id, ids)),
  });
}

/**
 * Money the seller says arrived — manual rails only. A card order is
 * Stripe's to settle: the webhook is the truth there, and a seller marking
 * one paid by hand would be recording a claim, not a fact.
 */
export async function bulkMarkPaid(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop("orders:write");
  const { a } = await getAdminT();
  const rows = await ownRows(shop.id, readIds(formData));

  const eligible = rows.filter(
    (o) => awaitsTransfer(o.paymentStatus) && o.paymentMethod !== "card",
  );

  let done = 0;
  for (const order of eligible) {
    const result = await pay(
      { shop, orderId: order.id, paymentStatus: "paid" },
      { notifyDownloads: (args) => sendDownloadReady(args) },
    );
    if (!result.ok) continue;
    done += 1;
    if (result.becamePaid) {
      const orderId = order.id;
      after(() => announceOrderPaid({ shop, orderId }));
    }
  }

  revalidatePath("/admin/orders");
  revalidatePath("/admin/clients");
  after(() => publishShopEvent(shop.id, "payment"));

  return {
    ok: true,
    message: tally(
      done,
      rows.length - done,
      a.orderList.bulkDone,
      a.orderList.bulkSkipped,
    ),
  };
}

/**
 * Parcels on their way, without tracking numbers — those are per-parcel
 * facts and stay on each order's page. The notify hook mirrors
 * `markOrderShipped`'s exactly (email + logged message on a real send); it
 * cannot be shared with that file because a `"use server"` module may only
 * export actions, and this glue is not one.
 */
export async function bulkMarkShipped(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop("orders:write");
  const { a } = await getAdminT();
  const rows = await ownRows(shop.id, readIds(formData));

  /* The fulfilment card's own gate: a parcel is a parcel even when no
     delivery method says so; explicit collection and digital goods never
     ship, and an order already shipped is not shipped twice. */
  const eligible = rows.filter(
    (o) =>
      !o.shippedAt &&
      (o.deliveryMethod === "shipping" ||
        (o.deliveryMethod === null && o.productKind === "physical")),
  );

  let done = 0;
  for (const order of eligible) {
    const result = await ship(
      { shop, orderId: order.id, carrier: "", trackingNumber: "", trackingUrl: "" },
      {
        notify: async ({ shop: s, order: o }) => {
          const sent = await sendShippingNotification({
            shop: s,
            order: o,
            arrivalUrl: arrivalUrl(o.id),
          });
          if (sent.sent) {
            await logOrderMessage({
              orderId: o.id,
              shopId: s.id,
              kind: "shipped",
              toAddress: o.customerEmail,
              subject: sent.subject,
              bodyText: sent.text,
              providerMessageId: sent.id,
              status: "sent",
            });
          }
          return sent;
        },
      },
    );
    if (result.ok) done += 1;
  }

  revalidatePath("/admin/orders");
  after(() => publishShopEvent(shop.id, "order"));

  return {
    ok: true,
    message: tally(
      done,
      rows.length - done,
      a.orderList.bulkDone,
      a.orderList.bulkSkipped,
    ),
  };
}

/** The seller's own workflow mark — no side effects, so the safest of the
 * three, but still through `changeOrderStatus` so the webhook fires and the
 * phone repaints. */
export async function bulkMarkCompleted(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop("orders:write");
  const { a } = await getAdminT();
  const rows = await ownRows(shop.id, readIds(formData));

  /* Cancelled and refunded orders are finished stories; re-marking them
     "completed" would overwrite what actually happened. */
  const eligible = rows.filter(
    (o) => o.status !== "completed" && o.status !== "cancelled" && o.status !== "refunded",
  );

  let done = 0;
  for (const order of eligible) {
    const change = await changeOrderStatus(
      { shop, orderId: order.id, status: "completed" },
      { defer: after, revalidate: () => {} },
    );
    if (change) done += 1;
  }

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  after(() => publishShopEvent(shop.id, "order"));

  return {
    ok: true,
    message: tally(
      done,
      rows.length - done,
      a.orderList.bulkDone,
      a.orderList.bulkSkipped,
    ),
  };
}
