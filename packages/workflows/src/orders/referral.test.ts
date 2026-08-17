import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Shop } from "@sailo/db/schema";

/**
 * The buyer's own referral link, offered right after they order.
 *
 * Everything here runs on the checkout path, *after* the order row is written. That
 * is the fact every branch below is about: this function's job is to return a link
 * or return null, and never to throw — because the thing it would fail is a sale
 * that already happened.
 *
 * The collision retry is the interesting part. `generateCode` derives a short code
 * from a name, so two buyers called Ada on one shop collide, and the insert is
 * `onConflictDoNothing` — which returns *nothing* precisely when that happens. An
 * earlier version read that empty result with `firstRow`, which threw, on the
 * checkout path, after the order was written.
 */

const affiliatesFindFirst = vi.fn();
const ensurePortalToken = vi.fn();
const generateCode = vi.fn();
const formatPercent = vi.fn();

/** What each `.returning()` hands back, in order — one entry per insert attempt. */
let returns: unknown[][];
let inserts: Record<string, unknown>[];

vi.mock("@sailo/db", () => ({
  getDb: () => ({
    query: { affiliates: { findFirst: affiliatesFindFirst } },
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        return {
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve(returns.shift() ?? []),
          }),
        };
      },
    }),
  }),
}));
vi.mock("@sailo/partners/portal", () => ({ ensurePortalToken }));
vi.mock("@sailo/core/pricing", () => ({ generateCode, formatPercent }));

const { referralFor } = await import("./referral");

const SHOP = { id: "shop-1", handle: "ada-shop", affiliateDefaultBp: 500 } as Shop;
const BASE = "https://sailo.store";

const active = (over: Record<string, unknown> = {}) => ({
  id: "aff-1",
  code: "ADA10",
  status: "active",
  commissionBp: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  returns = [];
  inserts = [];
  affiliatesFindFirst.mockResolvedValue(undefined);
  ensurePortalToken.mockResolvedValue("portal-token");
  generateCode.mockReturnValue("ADA10");
  formatPercent.mockImplementation((bp: number) => `${bp / 100}%`);
});

describe("a buyer who is already an affiliate", () => {
  it("reuses their existing code rather than minting a second one", async () => {
    affiliatesFindFirst.mockResolvedValue(active({ code: "OLD1" }));

    const result = await referralFor(SHOP, "Ada", "ada@example.com", BASE);

    expect(result?.code).toBe("OLD1");
    expect(inserts).toHaveLength(0);
  });

  /*
   * The seller can switch an affiliate off from the admin. A turned-off partner must
   * not be handed a link — and returning null rather than throwing is what keeps the
   * confirmation page rendering without the referral block.
   */
  it("gets nothing when the seller has turned them off", async () => {
    affiliatesFindFirst.mockResolvedValue(active({ status: "disabled" }));

    expect(await referralFor(SHOP, "Ada", "ada@example.com", BASE)).toBeNull();
  });
});

describe("a first-time referrer", () => {
  it("is created active, because this is the moment they said the shop is good", async () => {
    returns = [[active()]];

    await referralFor(SHOP, "Ada", "ada@example.com", BASE);

    expect(inserts[0]).toMatchObject({
      shopId: "shop-1",
      email: "ada@example.com",
      name: "Ada",
      status: "active",
      source: "buyer",
    });
  });

  /*
   * A buyer who never gave a name still needs one on the affiliate row, and the local
   * part of their address is the only thing available. "ada@example.com" becomes
   * "ada" rather than an empty label in the seller's partner list.
   */
  it("names an anonymous buyer from their address", async () => {
    returns = [[active()]];

    await referralFor(SHOP, null, "ada@example.com", BASE);

    expect(inserts[0]).toMatchObject({ name: "ada" });
    expect(generateCode).toHaveBeenCalledWith("ada");
  });

  it("returns a shareable link carrying the code", async () => {
    returns = [[active({ code: "ADA10" })]];

    const result = await referralFor(SHOP, "Ada", "ada@example.com", BASE);

    expect(result?.url).toBe("https://sailo.store/ada-shop?ref=ADA10");
  });

  /*
   * Without the portal link the confirmation hands out something to share and no way
   * to ever see what it earned. The report existed and nothing pointed at it.
   */
  it("returns a portal link, so the referrer can see what it earned", async () => {
    returns = [[active()]];

    const result = await referralFor(SHOP, "Ada", "ada@example.com", BASE);

    expect(result?.portalUrl).toBe("https://sailo.store/partner/portal-token");
  });
});

describe("the commission it advertises", () => {
  it("uses the affiliate's own rate when they have one", async () => {
    affiliatesFindFirst.mockResolvedValue(active({ commissionBp: 1500 }));

    const result = await referralFor(SHOP, "Ada", "ada@example.com", BASE);

    expect(formatPercent).toHaveBeenCalledWith(1500);
    expect(result?.percent).toBe("15%");
  });

  it("falls back to the shop's default", async () => {
    affiliatesFindFirst.mockResolvedValue(active({ commissionBp: null }));

    const result = await referralFor(SHOP, "Ada", "ada@example.com", BASE);

    expect(formatPercent).toHaveBeenCalledWith(500);
    expect(result?.percent).toBe("5%");
  });

  /*
   * Zero is a rate somebody chose — a shop running referrals for reach rather than
   * commission — so it must not fall through to the default. `?? ` is doing that
   * work and `||` would not.
   */
  it("respects a deliberate zero rather than treating it as unset", async () => {
    affiliatesFindFirst.mockResolvedValue(active({ commissionBp: 0 }));

    await referralFor(SHOP, "Ada", "ada@example.com", BASE);

    expect(formatPercent).toHaveBeenCalledWith(0);
  });
});

describe("when the generated code collides", () => {
  /*
   * `onConflictDoNothing` returns an empty array on collision, which is the signal to
   * try again with a freshly generated code. Two buyers called Ada on one shop is not
   * a rare event on a busy storefront.
   */
  it("retries and succeeds", async () => {
    returns = [[], [], [active({ code: "ADA12" })]];

    const result = await referralFor(SHOP, "Ada", "ada@example.com", BASE);

    expect(inserts).toHaveLength(3);
    expect(result?.code).toBe("ADA12");
  });

  /*
   * And gives up rather than looping. Five attempts is generous against a code space
   * this size; an unbounded retry on the checkout path is a hung request.
   */
  it("gives up after five attempts and returns nothing", async () => {
    returns = [[], [], [], [], []];

    const result = await referralFor(SHOP, "Ada", "ada@example.com", BASE);

    expect(inserts).toHaveLength(5);
    expect(result).toBeNull();
  });

  /*
   * The bug this shape replaced: an empty `.returning()` read with `firstRow` threw,
   * on the checkout path, after the order was written. Failing to mint a referral
   * code must never fail a completed sale.
   */
  it("does not throw when it cannot mint one at all", async () => {
    returns = [[], [], [], [], []];

    await expect(referralFor(SHOP, "Ada", "ada@example.com", BASE)).resolves.toBeNull();
  });
});
