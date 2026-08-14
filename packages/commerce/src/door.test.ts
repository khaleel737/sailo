import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Replaying a scan, and the one thing that must never happen at a door.
 *
 * A10's scanner queues admissions while a venue's wifi is out and replays them
 * on reconnect, so the same request genuinely arrives twice and the second is
 * not a mistake. Two properties, and they are not equally important:
 *
 * **Nobody is admitted twice.** Held by the conditional UPDATE inside
 * `checkInTicketForShop`, not by anything in this file — which is why the last
 * test here pulls Redis out entirely and checks that the answer degrades rather
 * than the guarantee.
 *
 * **The replay says what it said the first time.** That is what the key buys.
 * Without it the volunteer sees `already_used` on a guest who was in fact
 * admitted, and has to decide whether to believe their own scanner.
 */

/** An in-memory stand-in for Redis, and a switch to take it away. */
let store: Map<string, string>;
let redisUp: boolean;

vi.mock("@sailo/rate-limit", () => ({
  withRedis: async <T>(
    fn: (redis: unknown) => Promise<T>,
    fallback: T,
  ): Promise<T> => {
    // Exactly what the real one does when Redis is unconfigured or cold: hand
    // back the fallback, never throw, never hang.
    if (!redisUp) return fallback;
    return fn({
      get: async (key: string) => store.get(key) ?? null,
      set: async (
        key: string,
        value: string,
        opts?: { condition?: string },
      ) => {
        // `NX` — the first answer is the one that sticks.
        if (opts?.condition === "NX" && store.has(key)) return null;
        store.set(key, value);
        return "OK";
      },
    });
  },
}));

const checkInTicketForShop = vi.fn();
const checkInTicketById = vi.fn();
const issueTickets = vi.fn();
const setTicketRevoked = vi.fn();
const undoCheckIn = vi.fn();
vi.mock("./tickets", () => ({
  checkInTicketForShop,
  checkInTicketById,
  issueTickets,
  setTicketRevoked,
  undoCheckIn,
}));

const touchDoorPass = vi.fn();
vi.mock("./door-pass", () => ({ touchDoorPass }));

const publishShopEvent = vi.fn();
vi.mock("@sailo/events", () => ({ publishShopEvent }));

const { addWalkUp, admitByCode, admitOnce, undoAdmission } = await import("./door");

const DOOR = {
  shopId: "shop_A",
  productId: "event_1",
  by: "Ama on the door",
  passId: "pass_1",
};

const ADMITTED = {
  status: "checked_in",
  ticketId: "t_1",
  code: "AB123-CD456",
  attendee: "Okonkwo",
  buyer: "Okonkwo",
  tier: "Early bird",
  productTitle: "Friday session",
  eventStartsAt: null,
  usedAt: null,
  checkedInBy: "Ama on the door",
};

const ALREADY = { ...ADMITTED, status: "already_used" };

beforeEach(() => {
  store = new Map();
  redisUp = true;
  checkInTicketForShop.mockReset().mockResolvedValue(ADMITTED);
  checkInTicketById.mockReset().mockResolvedValue(ADMITTED);
  issueTickets.mockReset().mockResolvedValue([{ id: "t_new" }]);
  setTicketRevoked.mockReset().mockResolvedValue(true);
  undoCheckIn.mockReset().mockResolvedValue(true);
  touchDoorPass.mockReset();
  publishShopEvent.mockReset();
});

describe("admitting once", () => {
  it("admits, and says it was not a replay", async () => {
    const outcome = await admitOnce(DOOR, { code: "ab123cd456", idempotencyKey: "scan-1" });
    expect(outcome.result).toEqual(ADMITTED);
    expect(outcome.replayed).toBe(false);
  });

  it("answers a replayed scan with the original result", async () => {
    /*
     * The whole point. The second call must not reach the claim at all — and
     * if it did, the claim would answer `already_used`, which is the red
     * screen this exists to prevent.
     */
    const first = await admitOnce(DOOR, { code: "ab123cd456", idempotencyKey: "scan-1" });
    checkInTicketForShop.mockResolvedValue(ALREADY);
    const second = await admitOnce(DOOR, { code: "ab123cd456", idempotencyKey: "scan-1" });

    expect(checkInTicketForShop).toHaveBeenCalledTimes(1);
    expect(second.result).toEqual(first.result);
    expect(second.replayed).toBe(true);
  });

  it("treats a different key as a different scan", async () => {
    await admitOnce(DOOR, { code: "ab123cd456", idempotencyKey: "scan-1" });
    await admitOnce(DOOR, { code: "ab123cd456", idempotencyKey: "scan-2" });
    expect(checkInTicketForShop).toHaveBeenCalledTimes(2);
  });

  it("cannot hand one shop's admission to another shop's key", async () => {
    /*
     * The key is a string a client picked, so two shops will pick the same one.
     * Namespacing is what stops the second shop's scanner being told, in
     * detail, who walked into the first shop's venue.
     */
    await admitOnce(DOOR, { code: "ab123cd456", idempotencyKey: "scan-1" });
    const other = await admitOnce(
      { ...DOOR, shopId: "shop_B" },
      { code: "ab123cd456", idempotencyKey: "scan-1" },
    );

    expect(other.replayed).toBe(false);
    expect(checkInTicketForShop).toHaveBeenCalledTimes(2);
    expect([...store.keys()].every((k) => k.includes("shop_"))).toBe(true);
  });

  it("does not remember a refusal", async () => {
    /*
     * A `not_found` cached for a day keeps answering "no such ticket" about a
     * code the seller has since corrected. Re-running is cheap and the write
     * underneath is idempotent, so there is nothing to protect by caching it.
     */
    checkInTicketForShop.mockResolvedValue({ status: "not_found", code: "ZZ" });
    await admitOnce(DOOR, { code: "zz", idempotencyKey: "scan-1" });
    await admitOnce(DOOR, { code: "zz", idempotencyKey: "scan-1" });
    expect(checkInTicketForShop).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(0);
  });

  it("still admits exactly once when Redis is not there at all", async () => {
    /*
     * The property that matters, with the cache removed. `@sailo/rate-limit` is
     * explicit that Redis is an accelerator and never a source of truth; a
     * design that put the *safety* in the cache would turn an outage into a
     * door that admits everybody twice.
     *
     * So the replay runs — and the claim refuses it, exactly as it did before
     * any of this existed. The volunteer gets the worse answer and the guest
     * does not get counted twice.
     */
    redisUp = false;

    const first = await admitOnce(DOOR, { code: "ab123cd456", idempotencyKey: "scan-1" });
    checkInTicketForShop.mockResolvedValue(ALREADY);
    const second = await admitOnce(DOOR, { code: "ab123cd456", idempotencyKey: "scan-1" });

    expect(first.result).toMatchObject({ status: "checked_in" });
    expect(second.result).toMatchObject({ status: "already_used" });
    expect(second.replayed).toBe(false);
  });
});

describe("telling the other screens", () => {
  it("publishes and counts the pass when nothing schedules it", async () => {
    /*
     * Awaited, because `apps/api` has no `after()`. Three volunteers on three
     * phones is the case this exists for: one admits somebody and the other two
     * counters have to move, or the second volunteer lets the same person in
     * again while their screen still shows them outside.
     */
    await admitByCode(DOOR, "ab123cd456");
    expect(publishShopEvent).toHaveBeenCalledWith("shop_A", "booking");
    expect(touchDoorPass).toHaveBeenCalledWith("pass_1", true);
  });

  it("hands the announcement to a scheduler when the caller has one", async () => {
    const deferred: (() => Promise<void>)[] = [];
    await admitByCode(DOOR, "ab123cd456", { defer: (task) => deferred.push(task) });

    // Off the volunteer's tap, exactly as `after()` puts it.
    expect(publishShopEvent).not.toHaveBeenCalled();
    for (const task of deferred) await task();
    expect(publishShopEvent).toHaveBeenCalledWith("shop_A", "booking");
  });

  it("counts a scan that admitted nobody as a use of the pass, but not a check-in", async () => {
    // A pass that was held all evening and turned people away is a used pass;
    // an unused one has to stay visibly unused.
    checkInTicketForShop.mockResolvedValue(ALREADY);
    await admitByCode(DOOR, "ab123cd456");
    expect(touchDoorPass).toHaveBeenCalledWith("pass_1", false);
  });

  it("says nothing when an undo changed nothing", async () => {
    undoCheckIn.mockResolvedValue(false);
    expect(await undoAdmission(DOOR, "t_1")).toEqual({ ok: false });
    expect(publishShopEvent).not.toHaveBeenCalled();
  });
});

describe("walk-ups", () => {
  it("refuses one with no event to walk into", async () => {
    // There is no sensible shop-wide answer to "which door did this person
    // walk through", so an unscoped door mints nothing.
    const result = await addWalkUp({ ...DOOR, productId: null }, { name: "Ada" });
    expect(result).toEqual({ status: "not_found", code: "" });
    expect(issueTickets).not.toHaveBeenCalled();
  });

  it("records it as manual, so attendance and revenue stay different numbers", async () => {
    await addWalkUp(DOOR, { name: "  Ada  ", email: "ADA@Example.com " });
    expect(issueTickets).toHaveBeenCalledWith("shop_A", [
      expect.objectContaining({
        source: "manual",
        attendeeName: "Ada",
        attendeeEmail: "ada@example.com",
      }),
    ]);
  });

  it("refuses a name that is only whitespace", async () => {
    const result = await addWalkUp(DOOR, { name: "   " });
    expect(result).toEqual({ status: "not_found", code: "" });
    expect(issueTickets).not.toHaveBeenCalled();
  });
});
