import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { partnerProgramSettings } from "@sailo/db/schema";
import { maybeRow } from "@sailo/core/invariant";
import {
  DEFAULT_COMMISSION_BP,
  DEFAULT_COOKIE_DAYS,
  DEFAULT_HOLD_DAYS,
  DEFAULT_PAYOUT_MINIMUM_CENTS,
} from "./program";

/**
 * The terms of the partner programme, as one row anybody in /hq can edit.
 *
 * One reader (`getProgramSettings`) and one writer (`updateProgramSettings`),
 * so there is exactly one place that knows the row is a singleton and exactly
 * one place that knows what a sane value looks like.
 */

export type ProgramSettings = {
  acceptingApplications: boolean;
  autoApproveSellers: boolean;
  commissionBp: number;
  payoutMinimumCents: number;
  cookieDays: number;
  holdDays: number;
  autoPayout: boolean;
  payoutDayOfMonth: number;
  terms: string | null;
};

/**
 * The defaults, which are also what a database with no settings row behaves
 * like.
 *
 * The same numbers as the migration's column defaults, and deliberately
 * duplicated rather than read from it: a fresh install, a test database and a
 * production row that somebody deleted all have to behave identically, and the
 * only way to guarantee that is for the code to hold an answer of its own.
 */
export const PROGRAM_DEFAULTS: ProgramSettings = {
  acceptingApplications: true,
  autoApproveSellers: true,
  commissionBp: DEFAULT_COMMISSION_BP,
  payoutMinimumCents: DEFAULT_PAYOUT_MINIMUM_CENTS,
  cookieDays: DEFAULT_COOKIE_DAYS,
  holdDays: DEFAULT_HOLD_DAYS,
  autoPayout: true,
  payoutDayOfMonth: 1,
  terms: null,
};

/**
 * The programme's current terms.
 *
 * Falls back to `PROGRAM_DEFAULTS` rather than throwing when the row is
 * missing. This is read on the public landing page, inside the signup path and
 * by the webhook that records commission — none of those are places where a
 * missing settings row should be an error, and all three have a correct answer
 * without one.
 *
 * Not cached. It is a single-row primary-key lookup on a table with one row,
 * and the pages that read it are already doing more expensive work; a cache
 * here would buy nothing and would mean a rate change in /hq took five minutes
 * to reach the webhook that applies it.
 */
export async function getProgramSettings(): Promise<ProgramSettings> {
  const row = await getDb().query.partnerProgramSettings.findFirst({
    where: eq(partnerProgramSettings.id, 1),
  });
  if (!row) return PROGRAM_DEFAULTS;

  return {
    acceptingApplications: row.acceptingApplications,
    autoApproveSellers: row.autoApproveSellers,
    commissionBp: row.commissionBp,
    payoutMinimumCents: row.payoutMinimumCents,
    cookieDays: row.cookieDays,
    holdDays: row.holdDays,
    autoPayout: row.autoPayout,
    payoutDayOfMonth: row.payoutDayOfMonth,
    terms: row.terms,
  };
}

/**
 * Clamps one submitted setting into the range the database will accept.
 *
 * Here as well as in the CHECK constraints, because the two do different jobs:
 * the constraint stops a bad value being stored, and this stops a typo in a
 * form becoming a 500 on a panel. A rate of 300% is a slipped decimal point,
 * not an intention, and clamping it to 100% and showing the result is a kinder
 * answer than a stack trace.
 */
function clamp(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Writes the terms, and says who changed them.
 *
 * Upserts, so a database whose settings row was never seeded still takes an
 * edit. Every numeric field is clamped on the way in — see `clamp`.
 *
 * Note what this deliberately does *not* do: it does not touch a single
 * existing `referral_earnings` row. Changing the rate changes what the *next*
 * invoice earns, because every earning records the rate it was computed at.
 * A settings screen that silently restated last quarter's ledger would be the
 * worst bug in this feature.
 */
export async function updateProgramSettings(
  input: Partial<ProgramSettings>,
  actorEmail: string,
): Promise<ProgramSettings> {
  const current = await getProgramSettings();

  const next: ProgramSettings = {
    acceptingApplications:
      input.acceptingApplications ?? current.acceptingApplications,
    autoApproveSellers: input.autoApproveSellers ?? current.autoApproveSellers,
    commissionBp:
      input.commissionBp === undefined
        ? current.commissionBp
        : clamp(input.commissionBp, 0, 10_000, current.commissionBp),
    payoutMinimumCents:
      input.payoutMinimumCents === undefined
        ? current.payoutMinimumCents
        : clamp(input.payoutMinimumCents, 0, 100_000_00, current.payoutMinimumCents),
    cookieDays:
      input.cookieDays === undefined
        ? current.cookieDays
        : clamp(input.cookieDays, 0, 3650, current.cookieDays),
    holdDays:
      input.holdDays === undefined
        ? current.holdDays
        : clamp(input.holdDays, 0, 365, current.holdDays),
    autoPayout: input.autoPayout ?? current.autoPayout,
    payoutDayOfMonth:
      input.payoutDayOfMonth === undefined
        ? current.payoutDayOfMonth
        : // 28, not 31: a run scheduled for the 30th never fires in February.
          clamp(input.payoutDayOfMonth, 1, 28, current.payoutDayOfMonth),
    terms: input.terms === undefined ? current.terms : input.terms?.trim() || null,
  };

  await getDb()
    .insert(partnerProgramSettings)
    .values({ id: 1, ...next, updatedAt: new Date(), updatedBy: actorEmail })
    .onConflictDoUpdate({
      target: partnerProgramSettings.id,
      set: { ...next, updatedAt: new Date(), updatedBy: actorEmail },
    });

  return next;
}

/** Who last touched the terms, for the settings screen's own footer. */
export async function getSettingsAudit(): Promise<{
  updatedAt: Date;
  updatedBy: string | null;
} | null> {
  const row = maybeRow(
    await getDb()
      .select({
        updatedAt: partnerProgramSettings.updatedAt,
        updatedBy: partnerProgramSettings.updatedBy,
      })
      .from(partnerProgramSettings)
      .where(eq(partnerProgramSettings.id, 1))
      .limit(1),
  );
  return row ?? null;
}
