import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Telling registrants their event is about to start.
 *
 * The whole design question here is "how does this send exactly once", and the answer
 * is that the INSERT is the permission: `event_reminders` carries a unique index on
 * (order, product, lead), so Postgres arbitrates and nothing reads to decide whether
 * to write. That makes two rules worth pinning that a reader might otherwise
 * "simplify" away:
 *
 * - an empty `.returning()` from the claim means another pass got there first, which
 *   is the *ordinary* outcome and not an error
 * - a failed send does **not** roll the claim back, because a retried reminder is
 *   indistinguishable from a duplicate when the failure was in the provider's reply
 *
 * And the windows. The day-out pass stops where the hour-out pass begins, so somebody
 * registering forty minutes before the doors open gets one email rather than two at
 * once. That boundary is a pair of numbers with nothing in the type system defending
 * it, so it is asserted here by capturing what the query actually asks for.
 */

/** Every `gt`/`lte` bound the query built, in order, so the windows are readable. */
let bounds: { op: string; value: unknown }[];
/**
 * What each pass finds, in order — `[dayOut, hourOut]`.
 *
 * By call order rather than by lead, because the query runs *before* anything is
 * inserted, so there is nothing in the mocked chain that names the lead yet. The
 * order is fixed by `REMINDER_LEADS`, which the first test asserts.
 */
let duePasses: unknown[][];
/** What each claim INSERT returns — empty means somebody else claimed it. */
let claimResults: unknown[][];

const sendEventReminder = vi.fn();
const downloadUrl = vi.fn();
const inserted: Record<string, unknown>[] = [];
const deletes: string[] = [];

/*
 * Partially mocked, spreading the real module: `@sailo/db/schema` calls `relations()`
 * at import time, so a wholesale replacement makes the schema fail to load before a
 * single test runs. Only the comparators this file reads back are replaced.
 */
vi.mock("drizzle-orm", async (importActual) => {
  const actual = await importActual<typeof import("drizzle-orm")>();
  const record = (op: string) => (_column: unknown, value: unknown) => {
    bounds.push({ op, value });
    return { op, value };
  };
  return {
    ...actual,
    and: (...parts: unknown[]) => parts,
    gt: record("gt"),
    lte: record("lte"),
  };
});

vi.mock("@sailo/db", () => ({
  getDb: () => ({
    selectDistinctOn: () => ({
      from: () => ({
        innerJoin: function () {
          return this;
        },
        // The sessions join — spec 50. Left, so an event with no dates still
        // reminds off the product's own.
        leftJoin: function () {
          return this;
        },
        where: function () {
          return this;
        },
        limit: () => Promise.resolve(duePasses.shift() ?? []),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserted.push(values);
        return {
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve(claimResults.shift() ?? [{ id: "claim-1" }]),
          }),
        };
      },
    }),
    delete: () => ({
      where: () => {
        deletes.push("event_reminders");
        return Promise.resolve();
      },
    }),
  }),
}));
vi.mock("@sailo/commerce/orders/server", () => ({ downloadUrl }));
vi.mock("@sailo/email/transactional", () => ({ sendEventReminder }));

const { sendDueEventReminders, REMINDER_LEADS } = await import("./reminders");

const NOW = new Date("2026-08-17T12:00:00.000Z");

/**
 * A registrant whose event is coming up.
 *
 * `serviceMode` is what decides whether they get a join link or an address, so it is
 * a parameter of the fixture rather than a fixed value.
 */
const row = (over: Record<string, unknown> = {}) => ({
  order: {
    id: "order-1",
    downloadToken: "tok-1",
    customerEmail: "buyer@example.com",
    ...(over.order as object),
  },
  product: {
    id: "product-1",
    title: "Pottery evening",
    eventStartsAt: new Date("2026-08-18T09:00:00.000Z"),
    serviceMode: "in_person",
    serviceLocation: "The studio, 4 Mill Lane",
    eventJoinUrl: null,
    ...(over.product as object),
  },
  shop: { id: "shop-1", handle: "ada" },
  /*
   * The date this registration is for — spec 50. Null here, because that is
   * what a left join gives every event that runs once, which is all of them
   * until a seller adds dates.
   */
  session: (over.session as object) ?? null,
});

beforeEach(() => {
  vi.clearAllMocks();
  bounds = [];
  claimResults = [];
  inserted.length = 0;
  deletes.length = 0;
  duePasses = [[], []];
  sendEventReminder.mockResolvedValue({ sent: true });
  downloadUrl.mockReturnValue("https://sailo.store/t/tok-1");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("the two passes", () => {
  it("runs a day-out pass and an hour-out pass", async () => {
    expect(REMINDER_LEADS).toEqual(["24h", "1h"]);

    await sendDueEventReminders(NOW);

    // Two passes, each asking for a lower and an upper bound on the start time.
    expect(bounds.filter((b) => b.op === "gt")).toHaveLength(2);
    expect(bounds.filter((b) => b.op === "lte")).toHaveLength(2);
  });

  /*
   * THE BOUNDARY THAT STOPS A DOUBLE EMAIL
   *
   * If the day-out pass covered everything up to 24 hours away it would also cover
   * everything up to one hour away, and a late registrant would get both emails in
   * the same minute. So the day-out pass starts at +60 minutes, exactly where the
   * hour-out pass stops.
   */
  it("covers non-overlapping windows, so a late registrant gets one email", async () => {
    await sendDueEventReminders(NOW);

    /*
     * The bound arrives wrapped — spec 50.
     *
     * The window is now compared against `coalesce(session.starts_at,
     * product.event_starts_at)`, which is an expression rather than a column,
     * so drizzle has nothing to encode the value against and sends the wrong
     * literal. `sql.param(at, products.eventStartsAt)` names the encoder, and
     * what the comparator receives is that wrapper rather than a bare `Date`.
     * Unwrapped here, because the window this test is about is unchanged.
     */
    const dateOf = (value: unknown): Date =>
      value instanceof Date ? value : ((value as { value: Date }).value);
    const minutesFromNow = (value: unknown) =>
      Math.round((dateOf(value).getTime() - NOW.getTime()) / 60_000);

    const [dayFrom, hourFrom] = bounds.filter((b) => b.op === "gt");
    const [dayTo, hourTo] = bounds.filter((b) => b.op === "lte");

    expect(minutesFromNow(dayFrom?.value)).toBe(60);
    expect(minutesFromNow(dayTo?.value)).toBe(24 * 60);
    expect(minutesFromNow(hourFrom?.value)).toBe(0);
    expect(minutesFromNow(hourTo?.value)).toBe(60);

    // The seam: the day pass begins where the hour pass ends, with no gap either.
    expect(minutesFromNow(dayFrom?.value)).toBe(minutesFromNow(hourTo?.value));
  });
});

describe("claiming before sending", () => {
  it("claims a row, then sends", async () => {
    duePasses = [[row()], []];

    const result = await sendDueEventReminders(NOW);

    expect(inserted[0]).toMatchObject({
      orderId: "order-1",
      productId: "product-1",
      lead: "24h",
    });
    expect(sendEventReminder).toHaveBeenCalledOnce();
    expect(result.sent).toBe(1);
  });

  /*
   * An empty claim is the index doing its job: another pass, another region, or a
   * replayed cron got there first. It is the ordinary outcome and must not send.
   */
  it("sends nothing when another pass already claimed the row", async () => {
    duePasses = [[row()], []];
    claimResults = [[]];

    const result = await sendDueEventReminders(NOW);

    expect(sendEventReminder).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });

  it("carries on with the next row after a lost claim", async () => {
    duePasses = [[row(), row({ order: { id: "order-2" } })], []];
    claimResults = [[], [{ id: "claim-2" }]];

    const result = await sendDueEventReminders(NOW);

    expect(result.sent).toBe(1);
    expect(sendEventReminder).toHaveBeenCalledOnce();
  });

  /*
   * The date is part of the claim — spec 50.
   *
   * `0045` gives the unique index `NULLS NOT DISTINCT`, which is what makes a
   * null session collide with itself: an ordinary single-date event has to keep
   * claiming exactly once, or it is reminded on every cron tick for ever.
   */
  it("claims against the date, and against a null one for an event with none", async () => {
    duePasses = [[row({ session: { id: "session-4" } }), row({ order: { id: "order-2" } })], []];

    await sendDueEventReminders(NOW);

    expect(inserted[0]).toMatchObject({ orderId: "order-1", sessionId: "session-4" });
    expect(inserted[1]).toMatchObject({ orderId: "order-2", sessionId: null });
  });

  /*
   * Two dates of one class are two registrations, each with its own claim —
   * without the session in the key they collapse to one and the buyer is
   * reminded about Tuesday and never about Thursday.
   */
  it("claims once per date when a buyer booked two of them", async () => {
    duePasses = [
      [
        row({ session: { id: "tuesday" } }),
        row({ session: { id: "thursday" } }),
      ],
      [],
    ];

    const result = await sendDueEventReminders(NOW);

    expect(result.sent).toBe(2);
    expect(inserted.map((v) => v.sessionId)).toEqual(["tuesday", "thursday"]);
  });
});

describe("what the reminder says", () => {
  it("gives an online event its join link and no address", async () => {
    duePasses = [[], [
      row({
        product: {
          serviceMode: "online",
          eventJoinUrl: "https://meet.example/abc",
          serviceLocation: "ignored",
        },
      }),
    ]];

    await sendDueEventReminders(NOW);

    expect(sendEventReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          online: true,
          joinUrl: "https://meet.example/abc",
          location: null,
        }),
      }),
    );
  });

  it("gives an in-person event its address and no join link", async () => {
    duePasses = [[], [row()]];

    await sendDueEventReminders(NOW);

    expect(sendEventReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          online: false,
          joinUrl: null,
          location: "The studio, 4 Mill Lane",
        }),
      }),
    );
  });

  /*
   * The date the buyer actually booked — spec 50, and the reason this cron had
   * to learn about sessions at all.
   *
   * `products.event_starts_at` is the *first* Tuesday of a weekly class, so a
   * buyer holding the fourth one was told to come three weeks early and then
   * never heard again, because that send spent the claim.
   */
  it("names the date this registration is for, not the first of the series", async () => {
    const fourth = new Date("2026-09-08T18:00:00.000Z");
    duePasses = [[], [row({ session: { id: "s4", startsAt: fourth } })]];

    await sendDueEventReminders(NOW);

    expect(sendEventReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ startsAt: fourth }),
      }),
    );
  });

  /*
   * And that date's own room when it has one. A class that moves for a single
   * week has to say so on that week's mail rather than on all of them — the
   * same fallback `eventAccessForOrder` applies.
   */
  it("prefers the date's own room and link, falling back to the product's", async () => {
    duePasses = [
      [],
      [
        row({ session: { id: "s4", startsAt: NOW, location: "The big room" } }),
        row({ order: { id: "order-2" }, session: { id: "s5", startsAt: NOW } }),
      ],
    ];

    await sendDueEventReminders(NOW);

    expect(sendEventReminder).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        event: expect.objectContaining({ location: "The big room" }),
      }),
    );
    expect(sendEventReminder).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        event: expect.objectContaining({ location: "The studio, 4 Mill Lane" }),
      }),
    );
  });

  it("links the registrant's own portal when they have a token", async () => {
    duePasses = [[], [row()]];

    await sendDueEventReminders(NOW);

    expect(downloadUrl).toHaveBeenCalledWith("tok-1");
    expect(sendEventReminder).toHaveBeenCalledWith(
      expect.objectContaining({ portalUrl: "https://sailo.store/t/tok-1" }),
    );
  });

  it("sends no portal link rather than a broken one when there is no token", async () => {
    duePasses = [[], [row({ order: { id: "order-1", downloadToken: null } })]];

    await sendDueEventReminders(NOW);

    expect(downloadUrl).not.toHaveBeenCalled();
    expect(sendEventReminder).toHaveBeenCalledWith(
      expect.objectContaining({ portalUrl: null }),
    );
  });

  it("tells the mail which lead it is, so the copy can differ", async () => {
    duePasses = [[], [row()]];

    await sendDueEventReminders(NOW);

    expect(sendEventReminder).toHaveBeenCalledWith(expect.objectContaining({ lead: "1h" }));
  });
});

describe("when a send fails", () => {
  /*
   * THE TRADE-OFF, STATED
   *
   * The claim is not rolled back. A failed send with the row deleted would be retried
   * next pass, and "retried" is indistinguishable from "sent twice" when the failure
   * was in the provider's response rather than in the delivery. A registrant who was
   * not reminded is a smaller harm than one reminded twice an hour before their event
   * — and it is logged, so it is not silent.
   */
  it("keeps the claim rather than risking a duplicate", async () => {
    duePasses = [[row()], []];
    sendEventReminder.mockResolvedValue({ sent: false, reason: "hard bounce" });

    const result = await sendDueEventReminders(NOW);

    expect(deletes).toHaveLength(0);
    expect(result).toMatchObject({ sent: 0, failed: 1 });
  });

  it("says which order and which lead, so a miss is findable", async () => {
    duePasses = [[row()], []];
    sendEventReminder.mockResolvedValue({ sent: false, reason: "hard bounce" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await sendDueEventReminders(NOW);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("order-1"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("24h"));
  });

  it("keeps going through the rest of the pass", async () => {
    duePasses = [[row(), row({ order: { id: "order-2" } })], []];
    sendEventReminder
      .mockResolvedValueOnce({ sent: false, reason: "bounce" })
      .mockResolvedValueOnce({ sent: true });

    const result = await sendDueEventReminders(NOW);

    expect(result).toMatchObject({ sent: 1, failed: 1 });
  });
});

describe("the ceiling", () => {
  /*
   * One pass must not become an unbounded mail run. The query asks for one more than
   * the ceiling precisely so this can tell "exactly 500 due" from "more than 500 due"
   * and say which happened.
   */
  it("stops at five hundred and says it was clamped", async () => {
    duePasses = [Array.from({ length: 501 }, (_, i) => row({ order: { id: `o-${i}` } })), []];

    const result = await sendDueEventReminders(NOW);

    expect(result.clamped).toBe(true);
    expect(result.sent).toBe(500);
  });

  it("is not clamped when the pass fits", async () => {
    duePasses = [Array.from({ length: 3 }, (_, i) => row({ order: { id: `o-${i}` } })), []];

    const result = await sendDueEventReminders(NOW);

    expect(result.clamped).toBe(false);
    expect(result.sent).toBe(3);
  });

  it("warns when it clamps, because the remainder waits for the next tick", async () => {
    duePasses = [Array.from({ length: 501 }, (_, i) => row({ order: { id: `o-${i}` } })), []];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await sendDueEventReminders(NOW);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("500"));
  });
});
