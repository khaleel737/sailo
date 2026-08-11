import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { partners, shops, type Partner } from "@sailo/db/schema";
import { maybeRow } from "@/lib/invariant";
import { getProgramSettings } from "./settings";
import { newReferralCode, type PartnerStatus } from "./program";

/**
 * Joining the programme, and the decisions we make about people who have.
 *
 * The lifecycle is `pending → approved | rejected`, plus `approved →
 * suspended → approved` for people we stop and possibly restart. Every
 * transition goes through this file so the review trail is written the same
 * way every time, and so the one invariant that matters — an approved partner
 * has a code — is established in exactly one place.
 */

/* -------------------------------------------------------------------------- */
/*  Reading                                                                    */
/* -------------------------------------------------------------------------- */

/** The signed-in user's partner row, if they have ever applied. */
export async function getPartnerForUser(
  userId: string,
): Promise<Partner | null> {
  const row = await getDb().query.partners.findFirst({
    where: eq(partners.userId, userId),
  });
  return row ?? null;
}

export async function getPartnerById(id: string): Promise<Partner | null> {
  const row = await getDb().query.partners.findFirst({
    where: eq(partners.id, id),
  });
  return row ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Applying                                                                   */
/* -------------------------------------------------------------------------- */

export type ApplyOutcome =
  | { ok: true; status: PartnerStatus; partnerId: string }
  | { ok: false; error: string };

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  const shape = error as { code?: string; cause?: { code?: string } };
  return (
    shape?.code === UNIQUE_VIOLATION || shape?.cause?.code === UNIQUE_VIOLATION
  );
}

/**
 * Mints a code nothing else is using.
 *
 * The collision it retries against is real but vanishingly rare — 2^40 of
 * alphabet — so this loops rather than reserving in advance. Five attempts and
 * then a throw: a mint that cannot find a free code in five tries is a broken
 * random source, not bad luck, and quietly approving somebody without a code
 * would violate `partners_approved_has_code` anyway.
 *
 * The uniqueness is the index's job, not this function's. Checking first and
 * inserting after is the version with a race in it.
 */
async function claimCode(partnerId: string): Promise<string> {
  const db = getDb();

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newReferralCode();
    try {
      const claimed = maybeRow(
        await db
          .update(partners)
          // `is null` so a second approval never rotates a live code out from
          // under links that are already posted.
          .set({ code, updatedAt: new Date() })
          .where(and(eq(partners.id, partnerId), isNull(partners.code)))
          .returning({ code: partners.code }),
      );
      if (claimed?.code) return claimed.code;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      continue;
    }

    // No rows and no error: this partner already had a code. Read it rather
    // than guessing — it is the one their existing links carry.
    const existing = await db.query.partners.findFirst({
      where: eq(partners.id, partnerId),
      columns: { code: true },
    });
    if (existing?.code) return existing.code;
  }

  throw new Error(`Could not mint a partner code for ${partnerId}`);
}

/**
 * Puts someone in the programme, or in the queue for it.
 *
 * Auto-approval is for people who already run a paying shop: they are a known,
 * billed customer with a verified email, and making them wait days for a link
 * is friction with no fraud story behind it. Everyone else queues for a human,
 * which is the whole point of having a queue — a partner programme with no
 * review is a coupon-site farm within a month.
 *
 * Idempotent by `partners_user_key` rather than by a read-then-write: the
 * form is an ordinary double-submit target. A second application returns the
 * existing row's status instead of an error, because from the applicant's side
 * "I already applied" is not a failure.
 */
export async function applyToProgram(params: {
  userId: string;
  name: string;
  website?: string | null;
  audience?: string | null;
  pitch?: string | null;
}): Promise<ApplyOutcome> {
  const db = getDb();
  const settings = await getProgramSettings();

  const existing = await getPartnerForUser(params.userId);
  if (existing) {
    return {
      ok: true,
      status: existing.status as PartnerStatus,
      partnerId: existing.id,
    };
  }

  if (!settings.acceptingApplications) {
    return { ok: false, error: "The partner programme is closed to new applications right now." };
  }

  const name = params.name.trim();
  if (!name) return { ok: false, error: "Tell us what to call you." };

  /*
   * Their shop, if they have one — which is also the auto-approval test.
   * Looked up rather than passed in, so a form field cannot claim a shop the
   * applicant does not own.
   */
  const shop = await db.query.shops.findFirst({
    where: eq(shops.userId, params.userId),
    columns: { id: true, subscriptionStatus: true, plan: true },
  });

  const isPayingSeller =
    Boolean(shop) && shop?.plan !== "free" && shop?.subscriptionStatus === "active";
  const approveNow = settings.autoApproveSellers && isPayingSeller;
  const now = new Date();

  let inserted;
  try {
    [inserted] = await db
      .insert(partners)
      .values({
        userId: params.userId,
        shopId: shop?.id ?? null,
        status: approveNow ? "approved" : "pending",
        name,
        website: params.website?.trim() || null,
        audience: params.audience?.trim() || null,
        pitch: params.pitch?.trim() || null,
        appliedAt: now,
        ...(approveNow
          ? {
              reviewedAt: now,
              reviewedBy: "auto",
              reviewNote: "Auto-approved: active paying seller.",
            }
          : {}),
      })
      .returning();
  } catch (error) {
    // Somebody applied twice in the same breath. Their first one won.
    if (isUniqueViolation(error)) {
      const row = await getPartnerForUser(params.userId);
      if (row) {
        return { ok: true, status: row.status as PartnerStatus, partnerId: row.id };
      }
    }
    throw error;
  }

  if (!inserted) return { ok: false, error: "Couldn't file your application. Try again." };

  /*
   * The code comes after the row exists, not in the same insert, because
   * `claimCode` needs something to retry *against* when it collides. An
   * auto-approved partner without one would violate the check constraint, so a
   * failure here has to undo the approval rather than leave a half-made
   * partner behind.
   */
  if (approveNow) {
    try {
      await claimCode(inserted.id);
    } catch (error) {
      await db
        .update(partners)
        .set({ status: "pending", reviewedAt: null, reviewedBy: null, reviewNote: null })
        .where(eq(partners.id, inserted.id));
      throw error;
    }
  }

  return {
    ok: true,
    status: approveNow ? "approved" : "pending",
    partnerId: inserted.id,
  };
}

/* -------------------------------------------------------------------------- */
/*  Deciding                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Says yes, and mints the code that makes it real.
 *
 * The code is claimed before the status moves, so a partner is never approved
 * without one — the order matters because `partners_approved_has_code` would
 * refuse the update otherwise, and a caller that saw the refusal would have no
 * idea which half had failed.
 *
 * Re-approving a suspended partner is the same call and keeps their existing
 * code, so the links in their newsletter keep working.
 */
export async function approvePartner(
  partnerId: string,
  actorEmail: string,
  note?: string,
): Promise<string> {
  const code = await claimCode(partnerId);

  await getDb()
    .update(partners)
    .set({
      status: "approved",
      reviewedAt: new Date(),
      reviewedBy: actorEmail,
      reviewNote: note?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(partners.id, partnerId));

  return code;
}

/**
 * Says no, or stops someone we had already said yes to.
 *
 * `reviewNote` is shown to the partner and `notes` is not, which is the only
 * reason they are two columns. A rejection with no reason is a support ticket
 * we will answer by hand later.
 */
export async function setPartnerStatus(params: {
  partnerId: string;
  status: Extract<PartnerStatus, "rejected" | "suspended" | "pending">;
  actorEmail: string;
  note?: string;
}): Promise<void> {
  await getDb()
    .update(partners)
    .set({
      status: params.status,
      reviewedAt: new Date(),
      reviewedBy: params.actorEmail,
      reviewNote: params.note?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(partners.id, params.partnerId));
}

/**
 * Moves one partner onto a negotiated rate, or back onto the programme's.
 *
 * Null puts them back on the default. This never touches an existing earning:
 * every ledger row carries the rate it was computed at, so a new deal applies
 * from the next invoice and history stays true.
 */
export async function setPartnerCommission(
  partnerId: string,
  commissionBp: number | null,
): Promise<void> {
  const clamped =
    commissionBp === null
      ? null
      : Math.min(10_000, Math.max(0, Math.round(commissionBp)));

  await getDb()
    .update(partners)
    .set({ commissionBp: clamped, updatedAt: new Date() })
    .where(eq(partners.id, partnerId));
}

/** HQ's private note on a partner. Never shown to them. */
export async function setPartnerNotes(
  partnerId: string,
  notes: string,
): Promise<void> {
  await getDb()
    .update(partners)
    .set({ notes: notes.trim() || null, updatedAt: new Date() })
    .where(eq(partners.id, partnerId));
}
