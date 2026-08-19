import "server-only";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { checkoutSessions, clients, type CheckoutSession } from "@sailo/db/schema";
import { SESSION_TTL_MS, statusAfterPayment } from "./rules";

/**
 * Writing down that a checkout was opened, and what happened to it.
 *
 * The one **public write** this feature adds, so it is treated like one
 * throughout: the caller carries the ceiling (Decision B — fails closed, since
 * this creates rows for anybody), the response is never an existence oracle,
 * and nothing a browser sends is trusted beyond the opaque visitor key it was
 * given.
 *
 * **Never a card detail, never a client secret, never a PAN.** `lastError`
 * records that an attempt failed and roughly why, through an allowlist, and
 * nothing at all about the instrument.
 */

/** The most a stored decline message may be. Provider text, so it is bounded. */
const MAX_ERROR_LENGTH = 140;

/**
 * Decline reasons this feature will write down.
 *
 * An allowlist rather than a sanitiser, because the input is a provider string
 * that ends up rendered in the seller's panel: matching against a known set and
 * storing *our* word for it means nothing arbitrary is ever stored, let alone
 * displayed. An unrecognised code becomes `declined`, which is true and says
 * everything the seller can act on.
 */
const KNOWN_DECLINES = new Set([
  "insufficient_funds",
  "expired_card",
  "incorrect_cvc",
  "incorrect_number",
  "card_declined",
  "processing_error",
  "authentication_required",
  "do_not_honor",
  "lost_card",
  "stolen_card",
]);

export function sanitizeDecline(raw: string | null | undefined): string {
  if (!raw) return "declined";
  const code = raw.trim().toLowerCase().slice(0, MAX_ERROR_LENGTH);
  return KNOWN_DECLINES.has(code) ? code : "declined";
}

export type OpenSessionInput = {
  shopId: string;
  visitorKey: string;
  productId?: string | null;
  email?: string | null;
  phone?: string | null;
  clientId?: string | null;
  currency?: string | null;
  subtotalCents?: number | null;
  /** The already-persisted order behind a chat-rail handoff. */
  handoffOrderId?: string | null;
  now?: Date;
};

/**
 * Records that a checkout was opened, or that it was opened again.
 *
 * Their behaviour: *"if a customer revisits the same checkout from the same
 * device and browser, a new session is not created."* Implemented as an upsert
 * against the partial unique index rather than a read-then-write, so two tabs
 * opened at once produce one row instead of racing to create two.
 *
 * A revisit deliberately does **not** reset `openedAt`. The three-hour clock
 * runs from when they *first* looked, so a buyer who keeps the tab open and
 * glances at it every hour is still recoverable — resetting it would mean the
 * most interested buyers were the ones never written to.
 *
 * It also does not clear `status`. An `error` session that is revisited moves
 * back to `opened` through `markRevisited`, which is a different verb with a
 * different meaning; conflating them here would erase the record that a card
 * was declined the moment the buyer refreshed.
 */
export async function openSession(
  input: OpenSessionInput,
): Promise<CheckoutSession | null> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  const [row] = await getDb()
    .insert(checkoutSessions)
    .values({
      shopId: input.shopId,
      visitorKey: input.visitorKey,
      productId: input.productId ?? null,
      clientId: input.clientId ?? null,
      email: input.email?.trim().toLowerCase() || null,
      phone: input.phone?.trim() || null,
      currency: input.currency ?? null,
      subtotalCents: input.subtotalCents ?? null,
      handoffOrderId: input.handoffOrderId ?? null,
      status: "opened",
      openedAt: now,
      lastSeenAt: now,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [checkoutSessions.shopId, checkoutSessions.visitorKey, checkoutSessions.productId],
      targetWhere: sql`status in ('opened','error','help_requested') and product_id is not null`,
      set: {
        lastSeenAt: now,
        expiresAt,
        /*
         * Contact details are filled in, never blanked. A buyer who typed an
         * address on the first view and then reloaded the page — arriving with
         * an empty form — must not have the address forgotten, because it is
         * the only thing that makes them recoverable at all.
         */
        email: sql`coalesce(excluded.email, ${checkoutSessions.email})`,
        phone: sql`coalesce(excluded.phone, ${checkoutSessions.phone})`,
        clientId: sql`coalesce(excluded.client_id, ${checkoutSessions.clientId})`,
        currency: sql`coalesce(excluded.currency, ${checkoutSessions.currency})`,
        subtotalCents: sql`coalesce(excluded.subtotal_cents, ${checkoutSessions.subtotalCents})`,
      },
    })
    .returning();

  return row ?? null;
}

/**
 * A payment attempt failed.
 *
 * `error` rather than anything more final, because a declined card is a buyer
 * who *tried to pay* — the single most recoverable state this table has, and
 * the reason `error` is one of the two the recovery pass looks at.
 */
export async function markSessionError(input: {
  sessionId: string;
  shopId: string;
  decline?: string | null;
}): Promise<void> {
  await getDb()
    .update(checkoutSessions)
    .set({ status: "error", lastError: sanitizeDecline(input.decline), lastSeenAt: new Date() })
    .where(
      and(
        eq(checkoutSessions.id, input.sessionId),
        eq(checkoutSessions.shopId, input.shopId),
        // Only from a live state. A `recovered` session that receives a late
        // failed-attempt webhook must not be rewritten into an error.
        inArray(checkoutSessions.status, ["opened", "error", "recovering"]),
      ),
    );
}

/**
 * The buyer came back after a failure.
 *
 * Theirs: `error` returns to `opened` if they return. `lastError` is kept —
 * the seller's table shows what went wrong last time, and clearing it would
 * lose the one fact that explains a session that took three attempts.
 */
export async function markRevisited(input: {
  sessionId: string;
  shopId: string;
}): Promise<void> {
  await getDb()
    .update(checkoutSessions)
    .set({ status: "opened", lastSeenAt: new Date() })
    .where(
      and(
        eq(checkoutSessions.id, input.sessionId),
        eq(checkoutSessions.shopId, input.shopId),
        eq(checkoutSessions.status, "error"),
      ),
    );
}

/**
 * The checkout was paid.
 *
 * `recovered` only when the session was `recovering` *and* the buyer arrived
 * through the resume link — `statusAfterPayment` holds that rule, and it is
 * the difference between a metric and a flattering number.
 *
 * The status is computed from the row's own value in the same statement rather
 * than from one read a moment earlier: a recovery mail that went out between
 * the read and the write would otherwise be attributed or not attributed by
 * accident.
 */
export async function markSessionPaid(input: {
  sessionId: string;
  shopId: string;
  orderId: string;
  viaResumeLink: boolean;
  now?: Date;
}): Promise<"recovered" | "finalized" | null> {
  const now = input.now ?? new Date();

  const [current] = await getDb()
    .select({ status: checkoutSessions.status })
    .from(checkoutSessions)
    .where(
      and(
        eq(checkoutSessions.id, input.sessionId),
        eq(checkoutSessions.shopId, input.shopId),
      ),
    );
  if (!current) return null;

  const status = statusAfterPayment({
    status: current.status,
    viaResumeLink: input.viaResumeLink,
  });

  const [updated] = await getDb()
    .update(checkoutSessions)
    .set({
      status,
      orderId: input.orderId,
      recoveredAt: status === "recovered" ? now : null,
      lastSeenAt: now,
    })
    .where(
      and(
        eq(checkoutSessions.id, input.sessionId),
        eq(checkoutSessions.shopId, input.shopId),
        // The status this decision was made against, in the WHERE. If a tick
        // moved it in between, this write does not land and nothing is
        // mis-attributed.
        eq(checkoutSessions.status, current.status),
      ),
    )
    .returning({ id: checkoutSessions.id });

  return updated ? status : null;
}

/**
 * Claims a session for its one recovery mail.
 *
 * A conditional UPDATE and never a read-then-send: `recovery_sent_at is null`
 * in the WHERE is the whole of the "one, never a series" guarantee, and two
 * cron ticks reading a predicate concurrently would both find it null. The
 * winner gets the row back; the loser gets nothing and sends nothing.
 *
 * Claimed *before* the mail goes rather than marked after, which is the
 * deliberate direction: a crash between the claim and the send loses one
 * recovery email, and the other way round sends a second one to somebody who
 * already had it. Their standard — "we don't remind 10x" — makes that trade
 * for us.
 */
export async function claimForRecovery(input: {
  sessionId: string;
  now?: Date;
}): Promise<CheckoutSession | null> {
  const now = input.now ?? new Date();
  const [claimed] = await getDb()
    .update(checkoutSessions)
    .set({ status: "recovering", recoverySentAt: now })
    .where(
      and(
        eq(checkoutSessions.id, input.sessionId),
        inArray(checkoutSessions.status, ["opened", "error"]),
        isNull(checkoutSessions.recoverySentAt),
      ),
    )
    .returning();
  return claimed ?? null;
}

/** Records the coupon minted for one session, so a retry finds it rather than minting again. */
export async function attachDiscount(sessionId: string, code: string): Promise<void> {
  await getDb()
    .update(checkoutSessions)
    .set({ discountCode: code })
    .where(eq(checkoutSessions.id, sessionId));
}

/**
 * Retires sessions nobody will come back to.
 *
 * Thirty days, theirs. Deliberately not a delete: an expired session is the
 * denominator of the seller's recovery rate, and deleting it would make the
 * rate climb every month on its own.
 */
export async function expireSessions(now = new Date()): Promise<number> {
  const expired = await getDb()
    .update(checkoutSessions)
    .set({ status: "expired" })
    .where(
      and(
        inArray(checkoutSessions.status, ["opened", "error", "recovering", "help_requested"]),
        lt(checkoutSessions.expiresAt, now),
      ),
    )
    .returning({ id: checkoutSessions.id });
  return expired.length;
}

/** One session, scoped to its shop — the resume link's own lookup. */
export async function sessionFor(
  shopId: string,
  sessionId: string,
): Promise<CheckoutSession | null> {
  const row = await getDb().query.checkoutSessions.findFirst({
    where: and(
      eq(checkoutSessions.id, sessionId),
      eq(checkoutSessions.shopId, shopId),
    ),
  });
  return row ?? null;
}

/**
 * The client behind an address, so a session can be tied to a known buyer.
 *
 * Folded, because `clients.email` is stored as the buyer typed it.
 */
export async function clientForEmail(
  shopId: string,
  email: string,
): Promise<string | null> {
  const row = await getDb().query.clients.findFirst({
    where: and(
      eq(clients.shopId, shopId),
      sql`lower(${clients.email}) = ${email.toLowerCase()}`,
    ),
    columns: { id: true },
  });
  return row?.id ?? null;
}
