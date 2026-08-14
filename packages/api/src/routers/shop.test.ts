import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The shop router, where a seller's own row is written from a phone.
 *
 * Three things are worth a test here and the rest is not. The first is the
 * write allowlist: `shops` carries `plan`, `subscriptionStatus`,
 * `stripeAccountId` and `compPlan`, all decided by Stripe or by Sailo, and a
 * client that could set one of them could grant itself a plan. The second is
 * the handle, which is the storefront's address — claimed once, checked twice,
 * and racy in between. The third is `shop.create` running on `userProcedure`
 * rather than `shopProcedure`, because a seller who has just signed up has a
 * session and no shop, and resolving them by their shop would have made the
 * only procedure that gives them one unreachable.
 *
 * `setupSteps` itself is tested in @sailo/core. What is tested here is that
 * this procedure feeds it the *usable* rail count rather than the enabled one —
 * the distinction the onboarding card's whole correctness rests on.
 */

const shopsFindFirst = vi.fn();
const paymentMethodsFindMany = vi.fn();
const selectFrom = vi.fn();
const insertValues = vi.fn();
const updateSet = vi.fn();

vi.mock("@sailo/db", () => ({
  getDb: () => ({
    query: {
      shops: { findFirst: shopsFindFirst },
      paymentMethods: { findMany: paymentMethodsFindMany },
    },
    select: () => ({ from: selectFrom }),
    insert: () => ({ values: insertValues }),
    update: () => ({ set: updateSet }),
  }),
}));

const isRailUsable = vi.fn();
vi.mock("@sailo/payments/rails", () => ({ isRailUsable }));

const can = vi.fn();
vi.mock("@sailo/core/plans", () => ({ can }));

const rateLimit = vi.fn();
vi.mock("@sailo/rate-limit", () => ({ rateLimit }));

vi.mock("drizzle-orm", async (importActual) => ({
  ...(await importActual<typeof import("drizzle-orm")>()),
  eq: (column: unknown, value: unknown) => ({ __eq: { column, value } }),
  and: (...parts: unknown[]) => ({ __and: parts }),
  ne: (column: unknown, value: unknown) => ({ __ne: { column, value } }),
  count: () => ({ __count: true }),
  asc: (column: unknown) => ({ __asc: column }),
}));

const { shopRouter } = await import("./shop");

const SHOP = "11111111-1111-4111-8111-111111111111";
const USER = "user_1";

const caller = (ctx?: { shopId?: string | null; userId?: string | null }) =>
  shopRouter.createCaller({
    shopId: ctx?.shopId === undefined ? SHOP : ctx.shopId,
    userId: ctx?.userId === undefined ? USER : ctx.userId,
  });

/** A shop row with only the columns these procedures actually read. */
const shopRow = (over: Record<string, unknown> = {}) => ({
  id: SHOP,
  userId: USER,
  avatarUrl: null,
  logoUrl: null,
  socials: [],
  stripeChargesEnabled: false,
  currency: "AED",
  stripeAccountId: null,
  plan: "free",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockResolvedValue({ allowed: true, remaining: 100 });
  can.mockReturnValue(true);
  isRailUsable.mockReturnValue(true);
  paymentMethodsFindMany.mockResolvedValue([]);
  selectFrom.mockReturnValue({ where: () => Promise.resolve([{ n: 0 }]) });
});

describe("shop.update", () => {
  it("refuses to write a column the seller does not own", async () => {
    /*
     * The one that matters. `plan` is set by a Stripe webhook and by nothing
     * else; a spread of the input into `set()` would have let a client send
     * `{ plan: "business" }` and be upgraded for free. zod strips it before it
     * reaches the update, so the write never sees the key at all.
     */
    updateSet.mockReturnValue({
      where: () => ({ returning: () => Promise.resolve([{ id: SHOP }]) }),
    });

    await caller().update({
      name: "Forno",
      plan: "business",
      stripeAccountId: "acct_evil",
      suspendedAt: new Date().toISOString(),
    } as never);

    const written = updateSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(written).toHaveProperty("name", "Forno");
    expect(written).not.toHaveProperty("plan");
    expect(written).not.toHaveProperty("stripeAccountId");
    expect(written).not.toHaveProperty("suspendedAt");
  });

  it("treats an empty patch as a no-op rather than an error", async () => {
    // A settings screen that saves on blur sends one the moment a field is
    // focused and left alone.
    const result = await caller().update({});
    expect(result).toEqual({ id: SHOP });
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("refuses a caller with no shop", async () => {
    await expect(caller({ shopId: null }).update({ name: "x" })).rejects.toThrow();
  });
});

describe("shop.setup", () => {
  it("counts a rail as usable, not merely as enabled", async () => {
    /*
     * The distinction the card's correctness rests on. A rail switched on but
     * unconfigured shows no button to a buyer, so counting it would tick "you
     * can get paid" for a shop nobody can pay — and `isRailUsable` is the same
     * function the storefront checkout asks.
     */
    shopsFindFirst.mockResolvedValue(shopRow());
    paymentMethodsFindMany.mockResolvedValue([
      { type: "cash", config: {} },
      { type: "bank", config: {} },
    ]);
    isRailUsable.mockImplementation((type: string) => type === "cash");

    const { steps } = await caller().setup();
    expect(steps.find((s) => s.id === "paid")?.done).toBe(true);
    expect(isRailUsable).toHaveBeenCalledTimes(2);
  });

  it("does not count a card rail the plan has taken away", async () => {
    // A downgrade has to untick the step, not just grey a button in admin.
    shopsFindFirst.mockResolvedValue(shopRow());
    paymentMethodsFindMany.mockResolvedValue([{ type: "card", config: {} }]);
    can.mockReturnValue(false);

    const { steps } = await caller().setup();
    expect(steps.find((s) => s.id === "paid")?.done).toBe(false);
  });

  it("ticks the photo step for either image", async () => {
    // The storefront falls back from one to the other, so requiring a specific
    // one would ask for work that changes nothing.
    shopsFindFirst.mockResolvedValue(shopRow({ logoUrl: "https://x/logo.png" }));
    const { steps } = await caller().setup();
    expect(steps.find((s) => s.id === "photo")?.done).toBe(true);
  });

  it("counts every product, not just the first page", async () => {
    /*
     * Read as a count rather than derived from a list the client holds: a
     * seller with sixty products whose first page shows twenty must not be told
     * they have twenty.
     */
    shopsFindFirst.mockResolvedValue(shopRow());
    selectFrom.mockReturnValue({ where: () => Promise.resolve([{ n: 60 }]) });

    const { steps, progress } = await caller().setup();
    expect(steps.find((s) => s.id === "product")?.done).toBe(true);
    expect(progress.total).toBe(4);
  });
});

describe("shop.checkHandle", () => {
  it("answers `unknown` when throttled, never `taken`", async () => {
    /*
     * The distinction is the whole reason this returns a verdict rather than a
     * boolean. Telling somebody a free handle belongs to someone else leaves
     * them with no way forward, and `shop.create` re-checks for real anyway —
     * so a throttled caller is allowed to continue and risk a late error.
     */
    rateLimit.mockResolvedValue({ allowed: false, remaining: 0 });

    const result = await caller().checkHandle({ handle: "forno" });
    expect(result.verdict).toBe("unknown");
    expect(shopsFindFirst).not.toHaveBeenCalled();
  });

  it("refuses a reserved name and offers something free instead", async () => {
    shopsFindFirst.mockResolvedValue(undefined);
    const result = await caller().checkHandle({ handle: "admin" });
    expect(result.verdict).toBe("taken");
    expect(result.suggestions?.length ?? 0).toBeGreaterThan(0);
  });

  it("reports a free handle as available", async () => {
    shopsFindFirst.mockResolvedValue(undefined);
    const result = await caller().checkHandle({ handle: "forno" });
    expect(result).toMatchObject({ handle: "forno", verdict: "available" });
  });

  it("is bounded per account, not per shop", async () => {
    // It runs on `userProcedure`, so it is reachable before a shop exists —
    // keying the limit on the shop would have thrown for exactly the callers
    // who need it.
    shopsFindFirst.mockResolvedValue(undefined);
    await caller({ shopId: null }).checkHandle({ handle: "forno" });
    expect(rateLimit).toHaveBeenCalledWith(`handle:${USER}`, 120, 60);
  });

  it("refuses a caller with no session at all", async () => {
    await expect(
      caller({ shopId: null, userId: null }).checkHandle({ handle: "forno" }),
    ).rejects.toThrow();
  });
});

describe("shop.create", () => {
  const input = { handle: "forno", name: "Forno", currency: "aed" };

  it("works for a signed-in seller who has no shop yet", async () => {
    /*
     * The reason `userProcedure` exists. This is the state between creating an
     * account and claiming a handle, and on `shopProcedure` it would have been
     * unreachable — the caller cannot prove which shop they are, because that
     * is the thing they came to get.
     */
    shopsFindFirst.mockResolvedValue(undefined);
    insertValues.mockReturnValue({
      returning: () => Promise.resolve([{ id: SHOP, handle: "forno" }]),
    });

    const result = await caller({ shopId: null }).create(input);
    expect(result).toEqual({ id: SHOP, handle: "forno" });
  });

  it("files the row against the session's user, never against an input", async () => {
    shopsFindFirst.mockResolvedValue(undefined);
    insertValues.mockReturnValue({
      returning: () => Promise.resolve([{ id: SHOP, handle: "forno" }]),
    });

    await caller({ shopId: null }).create({ ...input, userId: "someone_else" } as never);
    expect(insertValues.mock.calls[0]?.[0]).toMatchObject({ userId: USER });
  });

  it("returns the existing shop rather than erroring on a second tap", async () => {
    /*
     * One shop per account, and a seller whose network dropped between the
     * insert and the response can tap again. Erroring would tell them their own
     * handle was taken.
     */
    shopsFindFirst.mockResolvedValue({ id: SHOP, handle: "forno" });

    const result = await caller({ shopId: null }).create(input);
    expect(result).toEqual({ id: SHOP, handle: "forno" });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("turns a lost race on the unique index into the taken message", async () => {
    // Two sign-ups can pass the availability check at the same moment. The
    // index is the real guarantee; this is what stops it surfacing as a 500.
    shopsFindFirst.mockResolvedValue(undefined);
    insertValues.mockReturnValue({
      returning: () =>
        Promise.reject(
          Object.assign(new Error("duplicate key"), {
            cause: { code: "23505", constraint: "shops_handle_key" },
          }),
        ),
    });

    await expect(caller({ shopId: null }).create(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("rethrows a violation that is not the handle's", async () => {
    // Another unique column failing is a different bug wearing the same code,
    // and reporting it as "handle taken" would send the seller to rename a
    // field that was fine.
    shopsFindFirst.mockResolvedValue(undefined);
    insertValues.mockReturnValue({
      returning: () =>
        Promise.reject(
          Object.assign(new Error("duplicate key"), {
            cause: { code: "23505", constraint: "shops_pkey" },
          }),
        ),
    });

    await expect(caller({ shopId: null }).create(input)).rejects.toThrow("duplicate key");
  });

  it("refuses a reserved handle before it reaches the database", async () => {
    shopsFindFirst.mockResolvedValue(undefined);
    await expect(caller({ shopId: null }).create({ ...input, handle: "admin" })).rejects.toThrow();
    expect(insertValues).not.toHaveBeenCalled();
  });
});
