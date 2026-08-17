import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Making sure a deleted store stops being charged.
 *
 * Two decisions worth pinning. The first is `isMissing`: a subscription Stripe has never
 * heard of counts as *cancelled*, and that is what lets a retry after a mid-way crash
 * finish rather than fail for ever. Read too loosely it would swallow a real error and
 * report a live subscription as cancelled — which is a seller still being billed for a
 * shop that no longer exists.
 *
 * The second is the read-back. Cancelling and trusting the call is not enough when the
 * entire point of the step is that nobody keeps being charged.
 */

const cancel = vi.fn();
const retrieve = vi.fn();
const billingEnabled = vi.fn();

vi.mock("@sailo/payments", () => ({
  billingEnabled,
  stripe: () => ({ subscriptions: { cancel, retrieve } }),
}));

const { cancelPlatformSubscription, isMissing } = await import("./subscription");

beforeEach(() => {
  vi.clearAllMocks();
  billingEnabled.mockReturnValue(true);
  cancel.mockResolvedValue({});
  retrieve.mockResolvedValue({ status: "canceled" });
});

describe("isMissing", () => {
  it("recognises Stripe's own code for a gone object", () => {
    expect(isMissing({ code: "resource_missing" })).toBe(true);
  });

  /*
   * Everything else is a real failure. A card error, a rate limit or a network blip must
   * not read as "already cancelled" — that would leave a live subscription billing a
   * deleted shop, and the deletion would report success.
   */
  it("does not mistake any other failure for success", () => {
    for (const error of [
      { code: "rate_limit" },
      { code: "api_error" },
      new Error("socket hang up"),
      { message: "resource_missing" },
      null,
      undefined,
      "resource_missing",
      {},
    ]) {
      expect(isMissing(error), JSON.stringify(error)).toBe(false);
    }
  });
});

describe("cancelPlatformSubscription", () => {
  it("cancels immediately, not at period end", async () => {
    await cancelPlatformSubscription("sub_1");

    // "Keep it running until the month is up" would be charging for a store that is
    // already gone.
    expect(cancel).toHaveBeenCalledWith("sub_1");
  });

  it("does nothing when there is no subscription", async () => {
    await cancelPlatformSubscription(null);

    expect(cancel).not.toHaveBeenCalled();
  });

  it("does nothing when billing is not configured at all", async () => {
    billingEnabled.mockReturnValue(false);

    await cancelPlatformSubscription("sub_1");

    expect(cancel).not.toHaveBeenCalled();
  });

  /*
   * The idempotency this step needs. A crash after the cancel but before the rest of the
   * deletion leaves a subscription Stripe has already forgotten — and the retry has to
   * get past this line rather than dying on it for ever.
   */
  it("treats an unknown subscription as already cancelled", async () => {
    cancel.mockRejectedValue({ code: "resource_missing" });

    await expect(cancelPlatformSubscription("sub_gone")).resolves.toBeUndefined();
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("re-throws a real failure rather than deleting the account anyway", async () => {
    cancel.mockRejectedValue({ code: "api_error", message: "Stripe is down" });

    await expect(cancelPlatformSubscription("sub_1")).rejects.toMatchObject({
      code: "api_error",
    });
  });

  /*
   * The read-back. Stripe accepting a cancel is not the same as the subscription being
   * cancelled, and this step exists precisely so that nobody keeps being charged.
   */
  it("confirms by re-reading, and refuses to proceed if it is still live", async () => {
    retrieve.mockResolvedValue({ status: "active" });

    await expect(cancelPlatformSubscription("sub_1")).rejects.toThrow(/still active/);
  });

  it("accepts a confirmed cancellation", async () => {
    retrieve.mockResolvedValue({ status: "canceled" });

    await expect(cancelPlatformSubscription("sub_1")).resolves.toBeUndefined();
  });
});
