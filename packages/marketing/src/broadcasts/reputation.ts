import "server-only";
import { and, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { broadcastDeliveries, shops } from "@sailo/db/schema";

/**
 * How a shop's mail is actually landing, and when that stops being our problem
 * to absorb.
 *
 * Every seller sends through one Resend account and one sending domain, so the
 * cost of one shop mailing a bought list is not paid by that shop — it is paid
 * by every other seller's order confirmations going to spam. The daily quota in
 * `quota.ts` limits how *much* a shop may send; this limits how *badly*. A shop
 * whose complaint or bounce rate crosses the line stops sending marketing until
 * a human has looked at it.
 *
 * What it deliberately does not do is take the shop off the air. Orders,
 * confirmations, receipts and the storefront are all untouched — see
 * `shops.marketingPausedAt`, which exists precisely so a bounce rate cannot
 * reach for `suspendedAt`.
 */

/** The rolling window. Long enough that one bad send cannot be averaged away. */
export const WINDOW_DAYS = 30;

/**
 * How much mail a shop must have sent before a rate means anything.
 *
 * Below this, one complaint out of nine is a 11% complaint rate and a pause
 * for a shop that has done nothing wrong. The floor is what makes the ratio a
 * measurement rather than an accident.
 */
export const MIN_VOLUME = 100;

/**
 * Gmail's published limit is 0.3% complaints, and at 0.3% the damage is already
 * done — the reputation that matters is the domain's, and it recovers slowly.
 * So this sits an order of magnitude below the number that gets you blocked.
 */
export const MAX_COMPLAINT_RATE = 0.001;
/** Bounces are cheaper to survive than complaints, and noisier. */
export const MAX_BOUNCE_RATE = 0.05;

export type PauseReason = "complaint_rate" | "bounce_rate";

export type Reputation = {
  /** Deliveries handed to the provider in the window. The denominator. */
  sent: number;
  complaints: number;
  bounces: number;
  /** Both zero when nothing was sent — never NaN, never Infinity. */
  complaintRate: number;
  bounceRate: number;
};

/**
 * The window's numbers for one shop.
 *
 * The denominator is `sentAt`, not `status = 'sent'`, and that is the whole
 * subtlety of this file.
 *
 * The Resend webhook flips a bounced or complained delivery from `sent` to
 * `failed` — and leaves `sentAt` alone. Counting `status = 'sent'` would
 * therefore exclude from the denominator exactly the rows that make up the
 * numerator: the rate inflates, a shop with only bad outcomes divides by zero,
 * and — worst of the three — a shop whose mail bounces often enough never
 * accumulates the 100 `sent` rows the volume floor asks for, so the check that
 * exists to catch it is the one thing it can never trip.
 *
 * `sentAt` survives that flip. It is written only on a successful handoff to
 * the provider (`send.ts:492`) and never on a send-time failure (`:499`), so it
 * means "we really did put this message on the wire" — which is the population
 * a deliverability rate is a rate *of*.
 */
export async function reputationFor(
  shopId: string,
  now = new Date(),
): Promise<Reputation> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 3_600_000);

  /*
   * `sentAt IS NOT NULL` rides on the numerators too, via the shared WHERE.
   * It keeps the numerator a subset of the denominator — a rate above 1 is not
   * a thing this function may return — and it keeps out send-time failures,
   * whose `error` is an arbitrary provider string that could say anything.
   */
  const [row] = await getDb()
    .select({
      sent: sql<string>`count(*)`,
      complaints: sql<string>`count(*) filter (where ${broadcastDeliveries.error} = 'complained')`,
      bounces: sql<string>`count(*) filter (where ${broadcastDeliveries.error} = 'bounced')`,
    })
    .from(broadcastDeliveries)
    .where(
      and(
        eq(broadcastDeliveries.shopId, shopId),
        isNotNull(broadcastDeliveries.sentAt),
        gte(broadcastDeliveries.sentAt, since),
      ),
    );

  return rates({
    sent: Number(row?.sent ?? 0),
    complaints: Number(row?.complaints ?? 0),
    bounces: Number(row?.bounces ?? 0),
  });
}

/** The division, with the zero guarded rather than hoped about. */
export function rates(counts: Pick<Reputation, "sent" | "complaints" | "bounces">): Reputation {
  const { sent, complaints, bounces } = counts;
  return {
    sent,
    complaints,
    bounces,
    complaintRate: sent === 0 ? 0 : complaints / sent,
    bounceRate: sent === 0 ? 0 : bounces / sent,
  };
}

/**
 * Whether these numbers are a reason to stop, and which one.
 *
 * Complaints are checked first: both can be over at once, and "people are
 * reporting this as spam" is the more serious sentence to have written on the
 * account when somebody comes to read it.
 */
export function pauseReasonFor(reputation: Reputation): PauseReason | null {
  if (reputation.sent < MIN_VOLUME) return null;
  if (reputation.complaintRate > MAX_COMPLAINT_RATE) return "complaint_rate";
  if (reputation.bounceRate > MAX_BOUNCE_RATE) return "bounce_rate";
  return null;
}

/**
 * Reads the window and pauses the shop's marketing if it has gone bad.
 *
 * Returns the reason it paused, or null — including null when the shop was
 * already paused, because the pause is not re-stamped. The first crossing is
 * the interesting timestamp; overwriting it every webhook would make an
 * account that has been broken for three weeks look like it broke this
 * morning.
 *
 * The `marketingPausedAt IS NULL` guard is in the UPDATE rather than in a read
 * before it. Bounces arrive in bursts and several webhooks can be in flight at
 * once; a check-then-write would let two of them both decide to pause, and the
 * second would move the timestamp. Postgres decides instead, and the loser
 * gets no row back.
 *
 * It throws what the database throws. The webhook that calls it is where the
 * decision not to fail on that lives — see the note there — because that is a
 * fact about the caller's retry semantics, not about this measurement.
 */
export async function evaluateShop(
  shopId: string,
  now = new Date(),
): Promise<PauseReason | null> {
  const reason = pauseReasonFor(await reputationFor(shopId, now));
  if (!reason) return null;

  const [paused] = await getDb()
    .update(shops)
    .set({
      marketingPausedAt: now,
      marketingPausedReason: reason,
      updatedAt: now,
    })
    .where(and(eq(shops.id, shopId), isNull(shops.marketingPausedAt)))
    .returning({ id: shops.id });

  if (!paused) return null;

  console.warn(`[sailo] shop ${shopId} marketing paused: ${reason}`);
  return reason;
}
