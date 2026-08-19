"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { dataRequests, shops } from "@sailo/db/schema";
import { EXPORT_TTL_DAYS } from "@sailo/core/privacy";
import {
  fulfilAccessRequest,
  fulfilErasureRequest,
  refuseDataRequest,
} from "@sailo/account/data-requests";
import {
  sendDataExportReady,
  sendErasureCompleted,
} from "@sailo/email/transactional";
import type { ActionState } from "@sailo/core/action-state";
import { requireStaff } from "@/lib/session";
import { recordOnAccount } from "./shared";

/**
 * Answering a buyer's data request on a seller's behalf. Spec 52.
 *
 * Three acts, one capability, and one rule that governs all of them:
 * **`privacy:act`, never a bare `requireStaff()`.** The auto-memory rule is
 * explicit — every HQ write names a `StaffCapability` — and this is exactly the
 * hole that shipped once: a page guarded staff-only, with actions under it that
 * asked no narrower question.
 *
 * `privacy:act` is its own capability and not `data:export`, because the two
 * describe different things. `data:export` is downloading rows for Sailo's own
 * purposes; this is acting *as the seller* in front of that seller's customer,
 * and half of what it can do is an erasure — which no amount of exporting could
 * perform and which `data:export` does not describe.
 *
 * Every one of the three records the acting address twice: into
 * `data_requests.actor` as `sailo:staff:<address>`, so "the seller answered" and
 * "we answered for them" are never the same row, and into `staff_actions` via
 * `recordOnAccount`, so the shop's own timeline shows it happened.
 */

/** `sailo:staff:<address>` — the shape the row is read back by. */
const actorFor = (email: string) => `sailo:staff:${email}`;

/** The request, and the shop it belongs to. Null when either is gone. */
async function loadRequest(id: string) {
  const db = getDb();
  const request = await db.query.dataRequests.findFirst({
    where: eq(dataRequests.id, id),
  });
  if (!request) return null;

  const shop = await db.query.shops.findFirst({
    where: eq(shops.id, request.shopId),
    columns: { id: true, name: true, userId: true },
  });
  return shop ? { request, shop } : null;
}

export async function staffReleaseDataExport(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff("privacy:act");

  const loaded = await loadRequest(String(formData.get("requestId") ?? ""));
  if (!loaded) return { ok: false, error: "That request no longer exists." };

  const result = await fulfilAccessRequest({
    shopId: loaded.shop.id,
    requestId: loaded.request.id,
    actor: actorFor(staff.email),
  });
  if (!result.ok) return { ok: false, error: result.error };

  await sendDataExportReady({
    to: loaded.request.email,
    shopName: loaded.shop.name,
    downloadUrl: result.downloadUrl,
    expiresInDays: EXPORT_TTL_DAYS,
  });

  await recordOnAccount(
    staff.email,
    "privacy.answered",
    loaded.shop.id,
    loaded.shop.userId,
    `Assembled and released a subject access export for ${loaded.request.email} on this shop's behalf`,
  );

  revalidatePath("/data-requests");
  return { ok: true, message: "Sent, and recorded against the shop." };
}

export async function staffEraseBuyerData(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff("privacy:act");

  if (String(formData.get("confirm") ?? "").trim().toLowerCase() !== "erase") {
    return { ok: false, error: 'Type "erase" to confirm.' };
  }

  const loaded = await loadRequest(String(formData.get("requestId") ?? ""));
  if (!loaded) return { ok: false, error: "That request no longer exists." };

  /*
   * The address, read before the erasure replaces it on every row it appears
   * on. Spec 03 makes the same move for the seller's farewell mail and for the
   * same reason: afterwards there is nothing left to send to.
   */
  const to = loaded.request.email;

  const result = await fulfilErasureRequest({
    shopId: loaded.shop.id,
    requestId: loaded.request.id,
    actor: actorFor(staff.email),
  });
  if (!result.ok) return { ok: false, error: result.error };

  await sendErasureCompleted({
    to,
    shopName: loaded.shop.name,
    statement: result.statement,
  });

  await recordOnAccount(
    staff.email,
    "privacy.erased",
    loaded.shop.id,
    loaded.shop.userId,
    `Erased a buyer's records on this shop's behalf — ` +
      `${result.report.clients} customer record(s), ${result.report.orders} order(s) anonymised; ` +
      `${result.report.suppressionsKept} suppression row(s) deliberately retained`,
  );

  revalidatePath("/data-requests");
  return { ok: true, message: "Erased, and recorded against the shop." };
}

export async function staffRefuseDataRequest(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff("privacy:act");

  const loaded = await loadRequest(String(formData.get("requestId") ?? ""));
  if (!loaded) return { ok: false, error: "That request no longer exists." };

  const reason = String(formData.get("reason") ?? "");
  const result = await refuseDataRequest({
    shopId: loaded.shop.id,
    requestId: loaded.request.id,
    reason,
    actor: actorFor(staff.email),
  });
  if (!result.ok) return { ok: false, error: result.error };

  await recordOnAccount(
    staff.email,
    "privacy.refused",
    loaded.shop.id,
    loaded.shop.userId,
    `Refused a buyer's data request on this shop's behalf: ${reason}`,
  );

  revalidatePath("/data-requests");
  return { ok: true, message: "Recorded as refused, with the reason." };
}
