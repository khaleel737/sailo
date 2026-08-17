import { describe, expect, it } from "vitest";
import {
  MAX_BOUNCE_RATE,
  MAX_COMPLAINT_RATE,
  MIN_VOLUME,
  pauseReasonFor,
  rates,
} from "./reputation";

/**
 * The verdict, without the database.
 *
 * `reputationFor` is one aggregate query and `evaluateShop` is one conditional
 * UPDATE; what is worth pinning down is the arithmetic between them, because
 * every mistake it can make is silent. A rate that divides by zero, a floor
 * that lets nine recipients pause a shop, a threshold read as `>=` — none of
 * those fail loudly. They just stop somebody's marketing, or fail to.
 */

describe("the rate", () => {
  it("is zero, not NaN, when nothing was sent", () => {
    const r = rates({ sent: 0, complaints: 0, bounces: 0 });
    expect(r.complaintRate).toBe(0);
    expect(r.bounceRate).toBe(0);
  });

  /*
   * The shape the webhook's flip would produce if `status = 'sent'` were the
   * denominator: every bad row leaves the denominator as it enters the
   * numerator. Reading `sentAt` instead is what keeps this arithmetic sane.
   */
  it("cannot exceed 1, even when every message went wrong", () => {
    const r = rates({ sent: 200, complaints: 100, bounces: 100 });
    expect(r.complaintRate).toBe(0.5);
    expect(r.bounceRate).toBe(0.5);
  });

  it("divides by what was handed to the provider", () => {
    expect(rates({ sent: 1_000, complaints: 3, bounces: 40 })).toMatchObject({
      complaintRate: 0.003,
      bounceRate: 0.04,
    });
  });
});

describe("the verdict", () => {
  const bad = { complaints: 50, bounces: 50 };

  it("says nothing below the volume floor, however bad it looks", () => {
    const r = rates({ sent: MIN_VOLUME - 1, ...bad });
    expect(r.complaintRate).toBeGreaterThan(MAX_COMPLAINT_RATE);
    expect(pauseReasonFor(r)).toBeNull();
  });

  it("starts judging at the floor itself", () => {
    expect(pauseReasonFor(rates({ sent: MIN_VOLUME, ...bad }))).toBe("complaint_rate");
  });

  it("leaves a clean shop alone", () => {
    expect(pauseReasonFor(rates({ sent: 10_000, complaints: 0, bounces: 0 }))).toBeNull();
  });

  it("pauses on complaints alone", () => {
    // 2 in 1,000 — twice the ceiling, and a rounding error to a bounce rate.
    const r = rates({ sent: 1_000, complaints: 2, bounces: 0 });
    expect(r.bounceRate).toBeLessThan(MAX_BOUNCE_RATE);
    expect(pauseReasonFor(r)).toBe("complaint_rate");
  });

  it("pauses on bounces alone", () => {
    const r = rates({ sent: 1_000, complaints: 0, bounces: 51 });
    expect(pauseReasonFor(r)).toBe("bounce_rate");
  });

  it("names complaints first when both are over", () => {
    expect(pauseReasonFor(rates({ sent: 1_000, complaints: 2, bounces: 200 }))).toBe(
      "complaint_rate",
    );
  });

  /*
   * Strictly over, both of them. A shop sitting exactly on the number has not
   * crossed it, and a shop that sends 1,000 with one complaint is the single
   * most common way to land exactly on 0.001.
   */
  it("leaves a shop sitting exactly on a threshold alone", () => {
    const complaints = rates({ sent: 1_000, complaints: 1, bounces: 0 });
    expect(complaints.complaintRate).toBe(MAX_COMPLAINT_RATE);
    expect(pauseReasonFor(complaints)).toBeNull();

    const bounces = rates({ sent: 1_000, complaints: 0, bounces: 50 });
    expect(bounces.bounceRate).toBe(MAX_BOUNCE_RATE);
    expect(pauseReasonFor(bounces)).toBeNull();
  });
});
