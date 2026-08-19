import { describe, expect, it } from "vitest";
import {
  RECOVERY_AFTER_MS,
  recoveryCouponCode,
  recoveryDue,
  recoveryEnabledFor,
  recoveryOffer,
  SESSION_STATUSES,
  statusAfterPayment,
  type RecoveryCandidate,
} from "./rules";

/**
 * The rules that decide whether a buyer who walked away hears from the shop.
 *
 * Two of them are worth more than the rest and both are here for a reason
 * neither is obvious:
 *
 * **`recovered` requires the link**, or the number a seller reads is their own
 * catalogue reflected back at them.
 *
 * **The discount is a coin flip**, or buyers learn to abandon on purpose. A
 * randomiser that cannot be seeded cannot be shown to be one, which is why the
 * roll is injected.
 */

const NOW = new Date("2026-08-19T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const candidate = (over: Partial<RecoveryCandidate> = {}): RecoveryCandidate => ({
  status: "opened",
  openedAt: ago(RECOVERY_AFTER_MS + 60_000),
  recoverySentAt: null,
  orderId: null,
  enabled: true,
  mailable: true,
  isMembership: false,
  subtotalCents: 2_500,
  ...over,
});

describe("whether recovery is on", () => {
  it("inherits the shop when the product has never been asked", () => {
    /*
     * The blank-vs-zero rule, on a path where reading `null` as `false` would
     * turn "I haven't decided" into "no" across an entire catalogue — silently,
     * and with revenue as the symptom.
     */
    expect(recoveryEnabledFor(true, null)).toBe(true);
    expect(recoveryEnabledFor(false, null)).toBe(false);
    expect(recoveryEnabledFor(true, undefined)).toBe(true);
  });

  it("lets a product override its shop, in both directions", () => {
    expect(recoveryEnabledFor(true, false)).toBe(false);
    expect(recoveryEnabledFor(false, true)).toBe(true);
  });
});

describe("whether this session is due", () => {
  it("is due three hours after it was opened", () => {
    expect(recoveryDue(candidate(), NOW)).toEqual({ due: true });
  });

  it("is not due a minute early", () => {
    expect(
      recoveryDue(candidate({ openedAt: ago(RECOVERY_AFTER_MS - 60_000) }), NOW),
    ).toEqual({ due: false, reason: "tooSoon" });
  });

  it("answers for every status, and only two are recoverable", () => {
    const due = SESSION_STATUSES.filter(
      (status) => recoveryDue(candidate({ status }), NOW).due,
    );
    /*
     * `error` is in and it is the interesting one: a buyer whose card was
     * declined is the buyer most worth writing to, because they tried to pay.
     */
    expect(due).toEqual(["opened", "error"]);
  });

  it("sends exactly one, ever", () => {
    // Their standard, verbatim: "it is one-time (we don't remind 10x)".
    expect(recoveryDue(candidate({ recoverySentAt: ago(1_000) }), NOW)).toEqual({
      due: false,
      reason: "alreadySent",
    });
  });

  it("says `paid` rather than anything else once there is an order", () => {
    // Checked before the clock: a paid checkout is not late, it is done.
    expect(
      recoveryDue(
        candidate({ orderId: "o1", openedAt: ago(RECOVERY_AFTER_MS - 60_000) }),
        NOW,
      ),
    ).toEqual({ due: false, reason: "paid" });
  });

  it("exempts a membership signup, like the sweep does", () => {
    // A trialling member's order is not an abandoned checkout.
    expect(recoveryDue(candidate({ isMembership: true }), NOW)).toEqual({
      due: false,
      reason: "membership",
    });
  });

  it("recovers nothing from a free checkout or a lead form", () => {
    for (const subtotalCents of [0, null]) {
      expect(recoveryDue(candidate({ subtotalCents }), NOW)).toEqual({
        due: false,
        reason: "nothingToRecover",
      });
    }
  });

  it("refuses an address the shop may not mail", () => {
    expect(recoveryDue(candidate({ mailable: false }), NOW)).toEqual({
      due: false,
      reason: "unmailable",
    });
  });

  it("refuses when the seller switched it off", () => {
    expect(recoveryDue(candidate({ enabled: false }), NOW)).toEqual({
      due: false,
      reason: "disabled",
    });
  });
});

describe("what a payment makes of it", () => {
  it("earns `recovered` only through the link", () => {
    expect(statusAfterPayment({ status: "recovering", viaResumeLink: true })).toBe(
      "recovered",
    );
  });

  it("is `finalized` when they came back on their own", () => {
    /*
     * The difference between a metric and a flattering number. Without this,
     * every sale from a buyer who ever abandoned anything counts as recovery,
     * and the seller reads their own catalogue back as a recovery rate.
     */
    expect(statusAfterPayment({ status: "recovering", viaResumeLink: false })).toBe(
      "finalized",
    );
    expect(statusAfterPayment({ status: "opened", viaResumeLink: true })).toBe(
      "finalized",
    );
    expect(statusAfterPayment({ status: "error", viaResumeLink: true })).toBe(
      "finalized",
    );
  });
});

describe("the discount", () => {
  const shop = { discountBp: 1_000, discountCents: null, oddsBp: 5_000 };

  it("is not awarded every time", () => {
    // The whole point. Award one always and buyers learn to abandon on purpose.
    expect(recoveryOffer({ ...shop, roll: 0.9 })).toBeNull();
    expect(recoveryOffer({ ...shop, roll: 0.1 })).toEqual({
      kind: "percent",
      basisPoints: 1_000,
    });
  });

  it("takes the odds literally at both ends", () => {
    expect(recoveryOffer({ ...shop, oddsBp: 0, roll: 0 })).toBeNull();
    expect(recoveryOffer({ ...shop, oddsBp: 10_000, roll: 0.999 })).not.toBeNull();
  });

  it("clamps odds a form could have got wrong", () => {
    expect(recoveryOffer({ ...shop, oddsBp: -5, roll: 0 })).toBeNull();
    expect(recoveryOffer({ ...shop, oddsBp: 99_999, roll: 0.999 })).not.toBeNull();
  });

  it("offers nothing when the seller configured nothing", () => {
    // A recovery mail with no discount is a perfectly good configuration —
    // it still carries the resume link, which is most of the value.
    expect(
      recoveryOffer({ discountBp: null, discountCents: null, oddsBp: 10_000, roll: 0 }),
    ).toBeNull();
  });

  it("does not stack a percentage and a flat amount", () => {
    /*
     * The migration says exactly one may be set and the form enforces it, but
     * a row is a row — and silently applying both is the one reading of two
     * columns that gives away more than the seller meant.
     */
    expect(
      recoveryOffer({ discountBp: 1_000, discountCents: 500, oddsBp: 10_000, roll: 0 }),
    ).toEqual({ kind: "percent", basisPoints: 1_000 });
  });

  it("caps a percentage at the whole order", () => {
    expect(
      recoveryOffer({ discountBp: 20_000, discountCents: null, oddsBp: 10_000, roll: 0 }),
    ).toEqual({ kind: "percent", basisPoints: 10_000 });
  });
});

describe("the coupon code", () => {
  it("is derived from the session, so a retry finds the same one", () => {
    const id = "0f8f2b1c-1234-4a5b-8c9d-abcdefabcdef";
    expect(recoveryCouponCode(id)).toBe(recoveryCouponCode(id));
    expect(recoveryCouponCode(id)).toMatch(/^BACK[0-9A-F]{8}$/);
  });

  it("differs between sessions", () => {
    expect(recoveryCouponCode("aaaaaaaa-1111-4a5b-8c9d-abcdefabcdef")).not.toBe(
      recoveryCouponCode("bbbbbbbb-1111-4a5b-8c9d-abcdefabcdef"),
    );
  });
});
