/**
 * When a checkout counts as abandoned, what it may be offered, and the two
 * rules that stop either from being farmed.
 *
 * Pure and client-safe. No database, no clock beyond what is passed in, no
 * randomness that is not injected — which is what makes the coin flip
 * assertable rather than a thing that is *probably* fair.
 */

/* --------------------------------------------------------------------------
   The vocabulary
-------------------------------------------------------------------------- */

/**
 * Theirs, adopted whole. Each one is a different fact about the same checkout
 * and the differences are the feature:
 *
 * - `opened` — the buyer is looking at it, or was.
 * - `error` — a payment attempt failed. Returns to `opened` if they come back,
 *   because a failed card is not an abandonment.
 * - `recovering` — the recovery mail has gone. Exactly one is ever sent.
 * - `recovered` — paid **from the recovery link**. Nothing else earns this.
 * - `finalized` — paid without one. The honest home for a buyer who came back
 *   through the seller's own newsletter, or simply remembered.
 * - `help_requested` — they left a phone number after an error.
 * - `expired` — thirty days, by cron.
 */
export const SESSION_STATUSES = [
  "opened",
  "error",
  "recovering",
  "recovered",
  "finalized",
  "help_requested",
  "expired",
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export function isSessionStatus(value: string): value is SessionStatus {
  return (SESSION_STATUSES as readonly string[]).includes(value);
}

/** How long after opening a checkout the follow-up is due. Theirs. */
export const RECOVERY_AFTER_MS = 3 * 3_600_000;

/** How long a session is remembered. Theirs: "we remember their entry for 30 days". */
export const SESSION_TTL_MS = 30 * 86_400_000;

/**
 * Statuses a session may still be recovered from.
 *
 * `error` is in and `expired` is not, and neither is obvious. A card that was
 * declined is the buyer most worth writing to — they tried to pay. An expired
 * session is one whose resume link no longer prices anything.
 */
const RECOVERABLE: readonly SessionStatus[] = ["opened", "error"];

/* --------------------------------------------------------------------------
   Whether recovery is on at all
-------------------------------------------------------------------------- */

/**
 * The shop's switch and the product's override, resolved.
 *
 * **`null` on the product means inherit**, and that is the whole of this
 * function. Blank is not false: `false` is a seller switching recovery off for
 * one product with the shop's setting left on, and `null` is a product that
 * has never been asked — which is every product that existed before the column
 * did. Reading `null` as `false` would turn "I haven't decided" into "no" for
 * an entire catalogue, silently.
 */
export function recoveryEnabledFor(
  shopEnabled: boolean,
  productEnabled: boolean | null | undefined,
): boolean {
  return productEnabled ?? shopEnabled;
}

/* --------------------------------------------------------------------------
   Whether *this* session is due
-------------------------------------------------------------------------- */

export type RecoveryCandidate = {
  status: string;
  openedAt: Date;
  recoverySentAt: Date | null;
  /** Set once the session became an order that was paid. */
  orderId: string | null;
  /** Whether the shop-or-product switch is on for this one. */
  enabled: boolean;
  /** Whether there is an address this shop is allowed to mail. */
  mailable: boolean;
  /**
   * A membership signup, which is exempt exactly as it is from the 24-hour
   * sweep: a trialling member's order is not an abandoned checkout.
   */
  isMembership: boolean;
  /** Nothing to recover from a free checkout, or from a lead form. */
  subtotalCents: number | null;
};

export type NotDue =
  | "status"
  | "tooSoon"
  | "alreadySent"
  | "paid"
  | "disabled"
  | "unmailable"
  | "membership"
  | "nothingToRecover";

/**
 * Whether this session earns the one email it will ever get, and if not, why.
 *
 * A reason rather than a boolean, because every one of these is a question a
 * seller eventually asks about a specific buyer, and "not eligible" answers
 * none of them.
 *
 * **One, never a series.** Their communication standard, adopted verbatim:
 * *"it is one-time (we don't remind 10x)."* `recoverySentAt` is the whole of
 * that guarantee, and it is checked here and set by a conditional UPDATE at
 * the send — because two cron ticks reading this predicate concurrently would
 * both find it null.
 */
export function recoveryDue(
  session: RecoveryCandidate,
  now: Date,
): { due: true } | { due: false; reason: NotDue } {
  if (!RECOVERABLE.includes(session.status as SessionStatus)) {
    return { due: false, reason: "status" };
  }
  // Checked before the clock, because a paid checkout is not late — it is done.
  if (session.orderId) return { due: false, reason: "paid" };
  if (session.recoverySentAt) return { due: false, reason: "alreadySent" };
  if (!session.enabled) return { due: false, reason: "disabled" };
  if (session.isMembership) return { due: false, reason: "membership" };

  /*
   * A free checkout and a lead form have nothing to recover, and `0` is the
   * answer for both. Null is a session that never got as far as a price, which
   * is the same nothing.
   */
  if (!session.subtotalCents || session.subtotalCents <= 0) {
    return { due: false, reason: "nothingToRecover" };
  }

  /*
   * Last, and deliberately: an unmailable address is the reason a seller most
   * often asks about, and evaluating it after the cheap checks means the
   * answer is specific rather than whichever condition happened to be first.
   */
  if (!session.mailable) return { due: false, reason: "unmailable" };

  if (now.getTime() - session.openedAt.getTime() < RECOVERY_AFTER_MS) {
    return { due: false, reason: "tooSoon" };
  }

  return { due: true };
}

/* --------------------------------------------------------------------------
   The transition into `recovered`
-------------------------------------------------------------------------- */

/**
 * What a payment turns this session into.
 *
 * **`recovered` requires the link.** Only a payment whose session was
 * `recovering` *and* which arrived through the signed resume token counts.
 * A buyer who came back from the seller's own newsletter, or who simply
 * remembered, is `finalized`.
 *
 * Theirs draws exactly this line and it is the difference between a metric and
 * a flattering number: without it, every sale from a buyer who ever abandoned
 * anything would be attributed to the recovery mail, and the seller would be
 * reading their own catalogue back to themselves as a recovery rate.
 */
export function statusAfterPayment(input: {
  status: string;
  /** True only when the checkout was entered through the resume token. */
  viaResumeLink: boolean;
}): "recovered" | "finalized" {
  return input.status === "recovering" && input.viaResumeLink
    ? "recovered"
    : "finalized";
}

/* --------------------------------------------------------------------------
   The discount
-------------------------------------------------------------------------- */

export type RecoveryOffer =
  | { kind: "percent"; basisPoints: number }
  | { kind: "fixed"; cents: number }
  | null;

/**
 * What this shop offers, if anything, and whether this buyer gets it.
 *
 * `roll` is injected rather than read from `Math.random` here, because a
 * randomiser that cannot be seeded cannot be tested, and the one property
 * worth asserting about this is that it is **not always yes**.
 *
 * The odds are the design, not a knob. Award a recovery discount every time
 * and buyers learn to abandon on purpose — which turns a recovery feature into
 * a discount the shop pays on sales it was going to make anyway.
 */
export function recoveryOffer(input: {
  discountBp: number | null;
  discountCents: number | null;
  oddsBp: number;
  /** In [0, 1). */
  roll: number;
}): RecoveryOffer {
  // Clamped rather than trusted: the column is an integer a seller typed into
  // a form, and 0 or 10000 are both legitimate ends of it.
  const odds = Math.min(10_000, Math.max(0, input.oddsBp));
  if (input.roll * 10_000 >= odds) return null;

  /*
   * Percentage wins when both are somehow set. The migration says exactly one
   * may be, and the form enforces it — but a row is a row, and silently
   * stacking a percentage *and* a flat amount is the one reading of two
   * columns that could give away more than the seller meant.
   */
  if (input.discountBp && input.discountBp > 0) {
    return { kind: "percent", basisPoints: Math.min(10_000, input.discountBp) };
  }
  if (input.discountCents && input.discountCents > 0) {
    return { kind: "fixed", cents: input.discountCents };
  }
  return null;
}

/**
 * The code a session's coupon is minted under.
 *
 * Derived from the session id rather than random, so a retried mint finds the
 * existing coupon instead of making a second one — and readable enough that a
 * seller looking at their coupon list can tell where it came from.
 */
export function recoveryCouponCode(sessionId: string): string {
  return `BACK${sessionId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}
