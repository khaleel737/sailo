import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { del, put } from "@vercel/blob";
import { getDb } from "@sailo/db";
import { clients, dataRequests, shops, type DataRequest } from "@sailo/db/schema";
import { randomHex } from "@sailo/core/token";
import {
  DATA_REQUEST_MESSAGES,
  EXPORT_TTL_DAYS,
  LIVE_REQUEST_STATUSES,
  VERIFY_TOKEN_TTL_DAYS,
  dueBy,
  isDataRequestKind,
  isRefusalReason,
  refusalBody,
  type DataRequestKind,
} from "@sailo/core/privacy";
import { assembleSubjectData, packSubjectExport } from "./assemble";
import { eraseSubject, erasureStatement, type ErasureReport } from "./erase";
import { dataRequestToken, hashDataRequestToken, readDataRequestToken } from "./tokens";

/**
 * A buyer's request about their own data, from the form to the answer.
 *
 * Spec 52. Beside `../deletion` because they are the two halves of the same
 * obligation — that one is the *seller* leaving, this one is a *buyer* asking —
 * and because both have to agree about what erasure means. Spec 03 decided it
 * first and this follows: anonymise what the ledger points at, keep the ledger.
 *
 * ## The four rules, in the order they bite
 *
 * 1. **Verification before assembly, always.** Nothing is read and nothing is
 *    written until the token mailed to the address comes back.
 * 2. **The clock starts at verification.** Thirty days from a request that
 *    exists, not from a stranger typing an address into a public form.
 * 3. **One sentence, whatever it found.** The form is an existence oracle by
 *    construction — its subject is literally whether a person is in a database —
 *    so it answers identically for a known address, an unknown one and a
 *    suppressed one, and it writes before it reads nothing.
 * 4. **The suppression list is never erased.** Stated in the reply as well as
 *    honoured in the code.
 */

export * from "./assemble";
export * from "./erase";
export * from "./tokens";

/* -------------------------------------------------------------------------- */
/*  Opening one                                                               */
/* -------------------------------------------------------------------------- */

export type OpenResult =
  | { ok: true; token: string | null; requestId: string; email: string }
  /**
   * Refused for a reason that is **not** about the database.
   *
   * `duplicate` is the partial unique index firing, which is a fact about the
   * caller's own recent behaviour rather than about our rows — but the caller
   * still reports `DATA_REQUEST_MESSAGES.received` for it, because "you already
   * have one open" would confirm to a stranger that a previous submission of
   * that address succeeded.
   */
  | { ok: false; reason: "duplicate" | "unavailable" };

/**
 * Record the request and mint the link.
 *
 * Writes first and reads nothing about whether the address is known — which is
 * what makes the constant answer honest rather than a performance. The
 * `clientId` below is resolved *after* the row exists and only to give the
 * seller's queue something to link to; it changes no answer.
 */
export async function openDataRequest(opts: {
  shopId: string;
  email: string;
  kind: DataRequestKind;
  now?: Date;
}): Promise<OpenResult> {
  const now = opts.now ?? new Date();
  const email = opts.email.trim().toLowerCase();
  const db = getDb();

  try {
    const [row] = await db
      .insert(dataRequests)
      .values({ shopId: opts.shopId, email, kind: opts.kind, status: "verifying" })
      /*
       * Nothing on conflict. The partial unique index is over the three live
       * statuses, so this fires exactly when the buyer already has one open of
       * this kind — which is not an error and not something to tell them about.
       */
      .onConflictDoNothing()
      .returning({ id: dataRequests.id });

    if (!row) return { ok: false, reason: "duplicate" };

    const expires = new Date(now.getTime() + VERIFY_TOKEN_TTL_DAYS * 86_400_000);
    const token = dataRequestToken(row.id, expires);

    if (token) {
      await db
        .update(dataRequests)
        .set({ verifyTokenHash: hashDataRequestToken(token) })
        .where(eq(dataRequests.id, row.id));
    }

    /*
     * The client row, if there is one, linked afterwards. Only so the seller's
     * queue can show who this is once the request is verified — nothing in the
     * public path branches on whether it was found.
     */
    const client = await db.query.clients.findFirst({
      where: and(eq(clients.shopId, opts.shopId), sql`lower(${clients.email}) = ${email}`),
      columns: { id: true },
    });
    if (client) {
      await db
        .update(dataRequests)
        .set({ clientId: client.id })
        .where(eq(dataRequests.id, row.id));
    }

    return { ok: true, token, requestId: row.id, email };
  } catch (error) {
    console.error("[sailo] data request could not be opened", error);
    return { ok: false, reason: "unavailable" };
  }
}

/* -------------------------------------------------------------------------- */
/*  Verifying                                                                 */
/* -------------------------------------------------------------------------- */

export type VerifyResult =
  | { ok: true; request: DataRequest; alreadyVerified: boolean }
  | { ok: false; reason: "invalid" | "unavailable" };

/**
 * Turn a click into a request, and start the clock.
 *
 * The token's signature proves it is ours and names the row; the stored hash
 * proves it is *this* row's. Both are needed: a signature alone would let a
 * token minted for request A be presented against request B.
 *
 * One refusal for every failure — forged, expired, already used on a fulfilled
 * request, or naming a row that no longer exists. The distinctions are all
 * information about our rows, offered to whoever is holding a token that does
 * not work.
 */
export async function verifyDataRequest(
  token: string,
  now = new Date(),
): Promise<VerifyResult> {
  const requestId = readDataRequestToken(token, now);
  if (!requestId) return { ok: false, reason: "invalid" };

  const db = getDb();

  try {
    const request = await db.query.dataRequests.findFirst({
      where: eq(dataRequests.id, requestId),
    });
    if (!request) return { ok: false, reason: "invalid" };
    if (request.verifyTokenHash !== hashDataRequestToken(token)) {
      return { ok: false, reason: "invalid" };
    }

    if (request.verifiedAt) {
      // A second click on a link already used. Not an error: mail clients
      // prefetch, and a buyer who clicks twice should see the same page.
      return { ok: true, request, alreadyVerified: true };
    }

    /*
     * A conditional claim, with the ceiling in the WHERE. Two clicks arriving
     * together — a prefetching mail client and the buyer — must set one
     * `verifiedAt` and start one clock, not two.
     */
    const [claimed] = await db
      .update(dataRequests)
      .set({
        status: "in_progress",
        verifiedAt: now,
        dueBy: dueBy(now),
        /*
         * The token is spent. It has done the only thing it can do, and leaving
         * a live hash on a row that is now actionable is a credential kept past
         * its purpose.
         */
        verifyTokenHash: null,
      })
      .where(and(eq(dataRequests.id, request.id), isNull(dataRequests.verifiedAt)))
      .returning();

    return claimed
      ? { ok: true, request: claimed, alreadyVerified: false }
      : { ok: true, request, alreadyVerified: true };
  } catch (error) {
    console.error("[sailo] data request verification failed", error);
    return { ok: false, reason: "unavailable" };
  }
}

/* -------------------------------------------------------------------------- */
/*  The seller's queue                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A shop's live requests, soonest deadline first.
 *
 * Unverified rows are excluded. Until the address is confirmed there is no
 * request from anybody, and a queue full of unverified submissions would let a
 * stranger fill a seller's screen by typing addresses into a public form.
 */
export async function dataRequestQueue(shopId: string, limit = 100) {
  return getDb()
    .select()
    .from(dataRequests)
    .where(and(eq(dataRequests.shopId, shopId), isNotNull(dataRequests.verifiedAt)))
    .orderBy(
      // Live ones first, then by deadline. A fulfilled request stays visible
      // because it is the seller's own evidence that they answered in time.
      sql`case when ${dataRequests.status} in ('in_progress', 'pending', 'verifying') then 0 else 1 end`,
      asc(dataRequests.dueBy),
      desc(dataRequests.createdAt),
    )
    .limit(limit);
}

/** One request, shop-scoped. The scoping is the access control. */
export async function dataRequestFor(
  shopId: string,
  id: string,
): Promise<DataRequest | null> {
  const row = await getDb().query.dataRequests.findFirst({
    where: and(eq(dataRequests.id, id), eq(dataRequests.shopId, shopId)),
  });
  return row ?? null;
}

/** Every shop's, for HQ. Shop-scoped rows, platform-wide list. */
export async function allDataRequests(limit = 100) {
  return getDb()
    .select({
      request: dataRequests,
      shopName: shops.name,
      shopHandle: shops.handle,
    })
    .from(dataRequests)
    .innerJoin(shops, eq(shops.id, dataRequests.shopId))
    .where(isNotNull(dataRequests.verifiedAt))
    .orderBy(asc(dataRequests.dueBy), desc(dataRequests.createdAt))
    .limit(limit);
}

/* -------------------------------------------------------------------------- */
/*  Answering                                                                 */
/* -------------------------------------------------------------------------- */

export type FulfilResult =
  | { ok: true; downloadUrl: string; expiresAt: Date }
  | { ok: false; error: string };

/**
 * Assemble the export, store it, and put an expiry on it.
 *
 * **Never an email attachment.** Personal data sitting in an inbox for ever is
 * the thing being asked about, and an attachment is the one delivery method
 * nobody can withdraw.
 *
 * The blob key carries 32 bytes of entropy so the URL is not guessable, and the
 * expiry is stored beside it so the hourly sweep can delete the object rather
 * than trusting a link to rot. An orphaned personal-data export in Blob is the
 * incident this whole feature exists to prevent.
 */
export async function fulfilAccessRequest(opts: {
  shopId: string;
  requestId: string;
  actor: string;
  now?: Date;
}): Promise<FulfilResult> {
  const now = opts.now ?? new Date();
  const db = getDb();

  const request = await dataRequestFor(opts.shopId, opts.requestId);
  if (!request) return { ok: false, error: "That request no longer exists." };

  /*
   * The rule the whole feature turns on, enforced at the one place it can be
   * broken. Assembling somebody's order history and *then* checking who asked
   * is how a data-protection feature becomes a breach.
   */
  if (!request.verifiedAt) {
    return { ok: false, error: "That request has not been confirmed by the buyer yet." };
  }
  if (request.kind !== "access" && request.kind !== "portability") {
    return { ok: false, error: "That request is not for a copy of the data." };
  }
  if (request.status === "fulfilled") {
    return { ok: false, error: "That request has already been answered." };
  }

  const assembled = await assembleSubjectData(request.shopId, request.email);
  const key = `data-requests/${request.shopId}/${request.id}-${randomHex(32)}.txt`;
  const expiresAt = new Date(now.getTime() + EXPORT_TTL_DAYS * 86_400_000);

  const stored = await put(key, packSubjectExport(assembled), {
    access: "public",
    contentType: "text/plain; charset=utf-8",
    /*
     * Unguessable by the 32 random bytes in the key, and short-lived. Blob has
     * no per-object authorisation, so the entropy *is* the control — which is
     * why the expiry is short and the object is actually deleted rather than
     * left to a link nobody visits.
     */
    addRandomSuffix: false,
  });

  await db
    .update(dataRequests)
    .set({
      status: "fulfilled",
      fulfilledAt: now,
      /*
       * The URL, which `del()` accepts as readily as a pathname — and which is
       * also the thing the seller is handed, so there is one string rather than
       * one to store and one to rebuild.
       */
      exportBlobKey: stored.url,
      exportExpiresAt: expiresAt,
      actor: opts.actor,
    })
    .where(eq(dataRequests.id, request.id));

  return { ok: true, downloadUrl: stored.url, expiresAt };
}

export type EraseResult =
  | { ok: true; report: ErasureReport; statement: string }
  | { ok: false; error: string };

/** Run the erasure, and record who ran it. */
export async function fulfilErasureRequest(opts: {
  shopId: string;
  requestId: string;
  actor: string;
  now?: Date;
}): Promise<EraseResult> {
  const now = opts.now ?? new Date();
  const request = await dataRequestFor(opts.shopId, opts.requestId);
  if (!request) return { ok: false, error: "That request no longer exists." };
  if (!request.verifiedAt) {
    return { ok: false, error: "That request has not been confirmed by the buyer yet." };
  }
  if (request.kind !== "erasure") {
    return { ok: false, error: "That request is not an erasure." };
  }
  if (request.status === "fulfilled") {
    return { ok: false, error: "That request has already been answered." };
  }

  const report = await eraseSubject(request.shopId, request.email, now);

  await getDb()
    .update(dataRequests)
    .set({ status: "fulfilled", fulfilledAt: now, actor: opts.actor })
    .where(eq(dataRequests.id, request.id));

  return { ok: true, report, statement: erasureStatement(report) };
}

/** Refuse it, from the picklist, with the reason recorded. */
export async function refuseDataRequest(opts: {
  shopId: string;
  requestId: string;
  reason: string;
  actor: string;
  now?: Date;
}): Promise<{ ok: true; body: string } | { ok: false; error: string }> {
  if (!isRefusalReason(opts.reason)) {
    return { ok: false, error: "Pick a reason for the refusal." };
  }

  const request = await dataRequestFor(opts.shopId, opts.requestId);
  if (!request) return { ok: false, error: "That request no longer exists." };
  if (request.status === "fulfilled" || request.status === "refused") {
    return { ok: false, error: "That request has already been answered." };
  }

  await getDb()
    .update(dataRequests)
    .set({
      status: "refused",
      refusedReason: opts.reason,
      fulfilledAt: opts.now ?? new Date(),
      actor: opts.actor,
    })
    .where(eq(dataRequests.id, request.id));

  return { ok: true, body: refusalBody(opts.reason) ?? "" };
}

/* -------------------------------------------------------------------------- */
/*  Housekeeping                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Delete every export past its expiry, and forget where it was.
 *
 * Hourly, from `/api/cron/sweep`. The key is cleared in the same pass so a
 * failure to delete does not leave a row pointing at an object that may or may
 * not still exist — and so a second tick does not try again forever on a blob
 * the store has already lost.
 */
export async function expireDataExports(now = new Date()): Promise<{ expired: number }> {
  const db = getDb();

  const due = await db
    .select({ id: dataRequests.id, key: dataRequests.exportBlobKey })
    .from(dataRequests)
    .where(
      and(isNotNull(dataRequests.exportBlobKey), lt(dataRequests.exportExpiresAt, now)),
    )
    .limit(100);

  let expired = 0;

  for (const row of due) {
    if (!row.key) continue;
    try {
      await del(row.key);
    } catch (error) {
      // A blob we could not delete is logged and the row is still cleared: the
      // alternative is retrying forever against an object the store has lost.
      console.error(`[sailo] data export ${row.id} survived expiry`, error);
    }
    await db
      .update(dataRequests)
      .set({ exportBlobKey: null, exportExpiresAt: null })
      .where(eq(dataRequests.id, row.id));
    expired += 1;
  }

  return { expired };
}

/** Requests whose deadline is close, for the seller's nudge. */
export async function dueSoon(shopId: string, withinDays: number, now = new Date()) {
  const horizon = new Date(now.getTime() + withinDays * 86_400_000);
  return getDb()
    .select({ id: dataRequests.id, dueBy: dataRequests.dueBy, kind: dataRequests.kind })
    .from(dataRequests)
    .where(
      and(
        eq(dataRequests.shopId, shopId),
        inArray(dataRequests.status, [...LIVE_REQUEST_STATUSES]),
        isNotNull(dataRequests.dueBy),
        lt(dataRequests.dueBy, horizon),
      ),
    );
}

/** Re-exported so a caller never has to remember which module the copy is in. */
export { DATA_REQUEST_MESSAGES, isDataRequestKind };
