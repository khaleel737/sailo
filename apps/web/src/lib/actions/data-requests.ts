"use server";

import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { rateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";
import { absolute } from "@sailo/core/origin";
import {
  DATA_REQUEST_MESSAGES,
  EXPORT_TTL_DAYS,
  VERIFY_TOKEN_TTL_DAYS,
  isDataRequestKind,
} from "@sailo/core/privacy";
import {
  fulfilAccessRequest,
  fulfilErasureRequest,
  openDataRequest,
  refuseDataRequest,
} from "@sailo/account/data-requests";
import {
  sendDataExportReady,
  sendDataRequestVerification,
  sendErasureCompleted,
} from "@sailo/email/transactional";
import { requireShop } from "@/lib/session";
import type { ActionState } from "@sailo/core/action-state";
import { revalidatePath } from "next/cache";

/**
 * The public end of a buyer's data request, and the seller's end of answering
 * it. Spec 52.
 *
 * ─── THE PUBLIC FORM IS AN EXISTENCE ORACLE BY CONSTRUCTION ─────────────────
 * Its subject is literally whether a person appears in a shop's database, so
 * the rule this repo applies to every public form applies here with no room at
 * all: **one response sentence whatever it finds.** A known address, an unknown
 * one, a suppressed one and an address that already has a request open all get
 * `DATA_REQUEST_MESSAGES.received`.
 *
 * `unavailable` is the one other thing it can say, and it is **not an answer
 * about the request**. Decision B has this endpoint failing closed — it writes,
 * it sends mail on a shared quota, and it is an oracle — so a refusal on
 * `verdict.reason === "outage"` reads as "we could not check", exactly as
 * `COUPON_MESSAGES.unavailable` does.
 */

export type DataRequestState = { done: boolean; error?: string };

export async function submitDataRequest(
  _prev: DataRequestState,
  formData: FormData,
): Promise<DataRequestState> {
  const handle = String(formData.get("handle") ?? "").trim().toLowerCase();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const kind = String(formData.get("kind") ?? "access");

  /*
   * The only thing this action refuses over, and it is not an oracle: whether
   * a string is shaped like an email address is knowable without our database.
   */
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    return { done: false, error: DATA_REQUEST_MESSAGES.invalidEmail };
  }
  if (!isDataRequestKind(kind)) {
    return { done: false, error: DATA_REQUEST_MESSAGES.invalidEmail };
  }

  /*
   * Two buckets, and they answer differently because only one of them can be
   * true of the caller.
   *
   * Per-address: somebody submitted this address minutes ago, so their link is
   * already in the inbox and `received` is a true sentence. It reports the
   * caller's own behaviour, not our rows.
   *
   * Per-IP: an office or a mobile carrier puts dozens of unrelated people
   * behind one address, so a first-time asker can trip it having done nothing.
   * Telling *them* to check an inbox nothing was sent to leaves them waiting
   * forever — throttled is unknown, never a positive answer.
   *
   * DECISION B — both fail closed. Unauthenticated, writes a row, sends mail,
   * and the answer says whether something exists.
   */
  const [byIp, byEmail] = await Promise.all([
    rateLimit(`data-request-ip:${await callerIp()}`, 6, 600, { onOutage: "closed" }),
    rateLimit(`data-request-email:${handle}:${email}`, 2, 3_600, { onOutage: "closed" }),
  ]);
  if (!byIp.allowed) return { done: false, error: DATA_REQUEST_MESSAGES.unavailable };
  if (!byEmail.allowed) return { done: true };

  const shop = await getDb().query.shops.findFirst({
    where: and(
      eq(shops.handle, handle),
      eq(shops.isPublished, true),
      isNull(shops.suspendedAt),
      isNull(shops.deletedAt),
    ),
    columns: { id: true, name: true, handle: true },
  });
  /*
   * No shop is our own routing being wrong rather than a fact about the
   * visitor — the handle came from the page they are standing on.
   */
  if (!shop) return { done: false, error: DATA_REQUEST_MESSAGES.unavailable };

  const opened = await openDataRequest({ shopId: shop.id, email, kind });

  /*
   * A duplicate reports `received`, and that is the whole point of handling it
   * here rather than letting it surface. "You already have one open" would
   * confirm to a stranger that a previous submission of that address worked,
   * which is the oracle wearing a helpful tone.
   */
  if (!opened.ok) {
    return opened.reason === "duplicate"
      ? { done: true }
      : { done: false, error: DATA_REQUEST_MESSAGES.unavailable };
  }

  if (!opened.token) {
    /*
     * No signing secret, so no link that could ever verify. Reported rather
     * than swallowed: a buyer told to check their inbox for a mail that was
     * never sent waits for something that will not arrive.
     */
    return { done: false, error: DATA_REQUEST_MESSAGES.unavailable };
  }

  const sent = await sendDataRequestVerification({
    to: email,
    shopName: shop.name,
    kind,
    verifyUrl: absolute(`/${shop.handle}/data-request/${opened.token}`),
    expiresInDays: VERIFY_TOKEN_TTL_DAYS,
  });

  return sent.sent
    ? { done: true }
    : { done: false, error: DATA_REQUEST_MESSAGES.unavailable };
}

/* -------------------------------------------------------------------------- */
/*  The seller's end                                                          */
/* -------------------------------------------------------------------------- */

/** Assemble and release the export, then mail the buyer the expiring link. */
export async function releaseDataExport(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { user, shop } = await requireShop();
  const id = String(formData.get("requestId") ?? "");

  const result = await fulfilAccessRequest({
    shopId: shop.id,
    requestId: id,
    actor: user.email,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const request = await getDb().query.dataRequests.findFirst({
    where: (rows, { eq: is }) => is(rows.id, id),
    columns: { email: true },
  });

  if (request) {
    await sendDataExportReady({
      to: request.email,
      shopName: shop.name,
      downloadUrl: result.downloadUrl,
      expiresInDays: EXPORT_TTL_DAYS,
    });
  }

  revalidatePath("/admin/data-requests");
  return {
    ok: true,
    message: `Sent. The link stops working in ${EXPORT_TTL_DAYS} days and the file is deleted.`,
  };
}

/** Erase what may be erased, keep what may not, and say which was which. */
export async function eraseBuyerData(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { user, shop } = await requireShop();
  const id = String(formData.get("requestId") ?? "");

  /*
   * A typed confirmation, the same shape spec 03 uses on the seller's own
   * deletion. This is irreversible and it is one click away from a queue of
   * rows that all look alike.
   */
  if (String(formData.get("confirm") ?? "").trim().toLowerCase() !== "erase") {
    return { ok: false, error: 'Type "erase" to confirm.' };
  }

  const request = await getDb().query.dataRequests.findFirst({
    where: (rows, { and: both, eq: is }) =>
      both(is(rows.id, id), is(rows.shopId, shop.id)),
    columns: { email: true },
  });

  const result = await fulfilErasureRequest({
    shopId: shop.id,
    requestId: id,
    actor: user.email,
  });
  if (!result.ok) return { ok: false, error: result.error };

  if (request) {
    /*
     * Sent to the address *before* it stopped being reachable — the erasure
     * above has just replaced it on the client and order rows, and this is the
     * copy captured before that. Spec 03 makes the same move for the seller's
     * own farewell mail and for the same reason: afterwards there is no way to
     * reach them at all.
     */
    await sendErasureCompleted({
      to: request.email,
      shopName: shop.name,
      statement: result.statement,
    });
  }

  revalidatePath("/admin/data-requests");
  return {
    ok: true,
    message: `Done. ${result.report.orders} order(s) anonymised; the suppression list was left alone, as it must be.`,
  };
}

/** Refuse it, from the picklist. */
export async function refuseBuyerRequest(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { user, shop } = await requireShop();

  const result = await refuseDataRequest({
    shopId: shop.id,
    requestId: String(formData.get("requestId") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    actor: user.email,
  });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/admin/data-requests");
  return { ok: true, message: "Recorded as refused, with the reason." };
}
