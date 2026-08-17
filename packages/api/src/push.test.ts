import { beforeEach, describe, expect, it, vi } from "vitest";
import { pushTokens } from "@sailo/db/schema";

/**
 * One device, one row — the property the whole push feature rests on.
 *
 * Registration runs on every launch the app has permission for, so "called
 * twice" is the normal case rather than the edge one, and the two ways it can
 * go wrong are opposites. Duplicate rows mean the seller's phone buzzes twice
 * per order and keeps buzzing for accounts they have left; a conflict target
 * that includes the user means a handset that changes hands keeps the previous
 * seller's row alongside the new one, and the next order lands on the lock
 * screen of somebody who no longer owns that shop.
 *
 * The fake below is an in-memory table that enforces uniqueness *on whatever
 * the router declares as its conflict target*, read back off the call rather
 * than assumed. So this is not a test that agrees with the code by
 * construction: widen the target to `(user_id, token)` and the handover test
 * fails, which is exactly the change that would break it in Postgres.
 */

type Row = Record<string, unknown>;

/** The table, as Postgres would keep it. Reset between tests. */
let rows: Row[] = [];

/** When a row was first written, fixed so "was this rewritten" is answerable. */
const FIRST_SEEN = new Date("2026-01-01T00:00:00Z");

/**
 * The JS key for a drizzle column, so the fake can honour a declared target
 * without being told which column it is.
 */
function keyOf(column: unknown): string {
  for (const [key, value] of Object.entries(pushTokens)) {
    if (value === column) return key;
  }
  throw new Error("conflict target is not a column of push_tokens");
}

const shopsFindFirst = vi.fn();

const db = {
  query: { shops: { findFirst: shopsFindFirst } },

  insert: (table: unknown) => {
    expect(table).toBe(pushTokens);
    return {
      values: (value: Row) => ({
        onConflictDoUpdate: async ({ target, set }: { target: unknown; set: Row }) => {
          const keys = (Array.isArray(target) ? target : [target]).map(keyOf);
          const existing = rows.find((row) => keys.every((k) => row[k] === value[k]));
          if (existing) Object.assign(existing, set);
          else rows.push({ createdAt: FIRST_SEEN, updatedAt: FIRST_SEEN, ...value });
        },
      }),
    };
  },

  delete: (table: unknown) => {
    expect(table).toBe(pushTokens);
    return {
      where: async (predicate: unknown) => {
        const wanted = decode(predicate);
        rows = rows.filter(
          (row) => !Object.entries(wanted).every(([k, v]) => row[k] === v),
        );
      },
    };
  },
};

vi.mock("@sailo/db", () => ({ getDb: () => db }));

/*
 * Neither is reached by a push procedure — they belong to `orders.updateStatus`
 * further up the same router. Stubbed for the same reason `router.test.ts`
 * stubs them: importing the router imports the whole file, and the real
 * `@sailo/commerce` pulls in `server-only`, which refuses to load outside a
 * server component and takes the suite down before a test runs.
 */
vi.mock("@sailo/commerce/orders/server", () => ({ applyOrderStatus: vi.fn() }));
vi.mock("@sailo/events", () => ({ publishShopEvent: vi.fn() }));

// Same treatment as `router.test.ts`: tag the predicate builders so the test can
// read back what each query compares against, and keep the rest of drizzle real
// so `@sailo/db/schema` still loads.
vi.mock("drizzle-orm", async (importActual) => ({
  ...(await importActual<typeof import("drizzle-orm")>()),
  eq: (column: unknown, value: unknown) => ({ __eq: { column, value } }),
  and: (...parts: unknown[]) => ({ __and: parts }),
}));

/** A tagged `and(eq(...), …)` read back as the row it would match. */
function decode(predicate: unknown): Row {
  const parts = (predicate as { __and?: unknown[] })?.__and ?? [predicate];
  const wanted: Row = {};
  for (const part of parts) {
    const eq = (part as { __eq?: { column: unknown; value: unknown } }).__eq;
    if (eq) wanted[keyOf(eq.column)] = eq.value;
  }
  return wanted;
}

const { appRouter } = await import("./router");

/** A real Expo token — `pushToken` refuses anything that isn't shaped like one. */
const DEVICE = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";
const OTHER_DEVICE = "ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]";

/** Two sellers, each with their own shop, as the context would resolve them. */
const ANA = { shopId: "shop_ana", userId: "user_ana" };
const BEN = { shopId: "shop_ben", userId: "user_ben" };

function callerFor(seller: { shopId: string; userId: string }) {
  shopsFindFirst.mockResolvedValue({ userId: seller.userId });
  return appRouter.createCaller({ shopId: seller.shopId, userId: seller.userId });
}

beforeEach(() => {
  rows = [];
  shopsFindFirst.mockReset();
});

describe("registering a device", () => {
  it("files the token against the shop's owner, not an id from the client", async () => {
    /*
     * The input carries a `userId` that a hostile client could have put there.
     * It is not in the schema, so zod drops it before the procedure runs and
     * the row is filed under the user the *shop* belongs to — the same rule
     * every read in this router follows, one step further along.
     */
    await callerFor(ANA).push.register({
      token: DEVICE,
      platform: "ios",
      userId: "user_someone_else",
    } as never);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe("user_ana");
    // And it was read from the shop rather than trusted from the wire.
    expect(shopsFindFirst).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — the same device twice is still one row", async () => {
    const ana = callerFor(ANA);
    await ana.push.register({ token: DEVICE, platform: "ios" });
    await ana.push.register({ token: DEVICE, platform: "ios" });
    await ana.push.register({ token: DEVICE, platform: "ios" });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: "user_ana", token: DEVICE });
  });

  it("moves the row when the handset changes hands", async () => {
    /*
     * The bug this is really about. Ana signs out, Ben signs in on the same
     * phone, and the device reports the token it already had. If both rows
     * survived, Ana's shop would keep pushing orders to a phone Ben is holding.
     */
    await callerFor(ANA).push.register({ token: DEVICE, platform: "ios" });
    await callerFor(BEN).push.register({ token: DEVICE, platform: "android" });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe("user_ben");
    // The platform moved with it: same token, re-minted on a different OS.
    expect(rows[0]?.platform).toBe("android");
  });

  it("does not rewrite when the device was first seen", async () => {
    // The row is the device, and the device is as old as it is. `updatedAt` is
    // the one that moves — it is the only evidence the device still exists.
    const ana = callerFor(ANA);
    await ana.push.register({ token: DEVICE, platform: "ios" });
    await ana.push.register({ token: DEVICE, platform: "ios" });

    expect(rows[0]?.createdAt).toBe(FIRST_SEEN);
    expect(rows[0]?.updatedAt).not.toBe(FIRST_SEEN);
    expect(rows[0]?.updatedAt).toBeInstanceOf(Date);
  });

  it("keeps a seller's separate devices apart", async () => {
    // Uniqueness is on the token, so one seller with a phone and a tablet is
    // two rows and gets two notifications — which is the point of the feature.
    const ana = callerFor(ANA);
    await ana.push.register({ token: DEVICE, platform: "ios" });
    await ana.push.register({ token: OTHER_DEVICE, platform: "ios" });

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.userId === "user_ana")).toBe(true);
  });

  it("refuses anything that is not an Expo push token", async () => {
    /*
     * Whatever is stored here is eventually POSTed to Expo, so the cheapest
     * place to refuse a junk value is before it becomes a row.
     */
    const ana = callerFor(ANA);
    await expect(
      ana.push.register({ token: "not-a-token", platform: "ios" }),
    ).rejects.toThrow();
    await expect(
      ana.push.register({ token: "ExponentPushToken[]", platform: "ios" }),
    ).rejects.toThrow();
    expect(rows).toHaveLength(0);
  });

  it("refuses when no shop resolved, without touching the table", async () => {
    await expect(
      appRouter.createCaller({ shopId: null, userId: null }).push.register({
        token: DEVICE,
        platform: "ios",
      }),
    ).rejects.toThrow(/sign in/i);
    expect(shopsFindFirst).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });
});

describe("forgetting a device", () => {
  it("removes the row, so a signed-out phone stops being notified", async () => {
    const ana = callerFor(ANA);
    await ana.push.register({ token: DEVICE, platform: "ios" });
    await ana.push.unregister({ token: DEVICE });

    expect(rows).toHaveLength(0);
  });

  it("deletes only the caller's own row", async () => {
    // Scoped by user as well as token: "delete where the client says" is a
    // habit worth not having in a router whose whole job is scoping.
    await callerFor(ANA).push.register({ token: DEVICE, platform: "ios" });
    await callerFor(BEN).push.unregister({ token: DEVICE });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe("user_ana");
  });

  it("is idempotent too — forgetting an unknown device is not an error", async () => {
    // Sign-out calls this whether or not the device ever registered, and a
    // seller who declined notifications has no row to remove.
    await expect(
      callerFor(ANA).push.unregister({ token: DEVICE }),
    ).resolves.toEqual({ registered: false });
    expect(rows).toHaveLength(0);
  });
});
