import { describe, expect, it } from "vitest";
import {
  MAX_SESSIONS,
  buyableSessions,
  buyableTiers,
  repeatWeekly,
} from "./tickets";

/**
 * The whole of recurrence in spec 50 is "repeat weekly × N", so what is pinned
 * here is the one thing a seller would notice and could not explain: a 19:00
 * class that becomes an 18:00 class halfway through the run.
 */

describe("repeatWeekly", () => {
  it("adds dates after the one it was given, not including it", () => {
    expect(repeatWeekly("2026-09-01T19:00", 3)).toEqual([
      "2026-09-08T19:00",
      "2026-09-15T19:00",
      "2026-09-22T19:00",
    ]);
  });

  it("keeps the clock time across a daylight-saving change", () => {
    /*
     * Europe/London puts its clocks back on 25 October 2026 and the US does so
     * a week later, so a seller in either zone generating a weekly class across
     * that weekend is the ordinary case rather than the exotic one. Adding
     * seven days against the browser's own zone moves 19:00 to 18:00 for the
     * rest of the run — a whole term of classes an hour early, with nothing on
     * any screen saying why.
     */
    expect(repeatWeekly("2026-10-20T19:00", 2)).toEqual([
      "2026-10-27T19:00",
      "2026-11-03T19:00",
    ]);
  });

  it("crosses a month and a year without drifting", () => {
    expect(repeatWeekly("2026-12-29T09:30", 2)).toEqual([
      "2027-01-05T09:30",
      "2027-01-12T09:30",
    ]);
  });

  it("answers nothing for a date the seller has not chosen yet", () => {
    // A blank first date is an unfinished form, not an error to shout about.
    expect(repeatWeekly("", 4)).toEqual([]);
    expect(repeatWeekly("not a date", 4)).toEqual([]);
  });

  it("clamps the count to what one event may hold", () => {
    expect(repeatWeekly("2026-09-01T19:00", 0)).toHaveLength(1);
    expect(repeatWeekly("2026-09-01T19:00", -5)).toHaveLength(1);
    expect(repeatWeekly("2026-09-01T19:00", 500)).toHaveLength(MAX_SESSIONS);
    expect(repeatWeekly("2026-09-01T19:00", Number.NaN)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/*  What the buyer is offered                                                  */
/* -------------------------------------------------------------------------- */

const NOW = new Date("2026-09-01T12:00:00Z");
const later = (days: number) =>
  new Date(NOW.getTime() + days * 24 * 3_600_000);

const tier = (over: Partial<Parameters<typeof buyableTiers>[0][number]> = {}) => ({
  id: "t1",
  name: "VIP",
  description: null,
  priceCents: 5000,
  capacity: 30,
  sold: 0,
  maxPerOrder: null,
  isHidden: false,
  sellFrom: null,
  sellUntil: null,
  ...over,
});

const session = (
  over: Partial<Parameters<typeof buyableSessions>[0][number]> = {},
) => ({
  id: "s1",
  startsAt: later(7),
  endsAt: null,
  capacity: 10,
  sold: 0,
  location: null,
  isCancelled: false,
  ...over,
});

describe("the bands a buyer may see", () => {
  /*
   * The rule that costs a sale when it is got wrong the other way: a band that
   * has gone has to *stay on screen*, struck through. Removing it makes the
   * buyer wonder whether they mis-read the page, and makes the seller believe
   * their tier disappeared.
   */
  it("keeps a sold-out band listed and marks it", () => {
    const [full] = buyableTiers([tier({ capacity: 30, sold: 30 })], { now: NOW });
    expect(full).toMatchObject({ soldOut: true, seatsLeft: 0 });
  });

  it("counts seats left, and counts none for a band that shares the room", () => {
    expect(buyableTiers([tier({ sold: 28 })], { now: NOW })[0]).toMatchObject({
      seatsLeft: 2,
      soldOut: false,
    });
    // NULL capacity is "share the product's stock" — a band that names a price
    // rather than rationing anything, so there is no number to show.
    expect(
      buyableTiers([tier({ capacity: null, sold: 99 })], { now: NOW })[0],
    ).toMatchObject({ seatsLeft: null, soldOut: false });
  });

  /*
   * "Reachable by direct link only" means the link is the credential: unlisted
   * until the request names it, and named reveals exactly that band.
   */
  it("hides a hidden band until its own link names it", () => {
    const rows = [tier(), tier({ id: "press", name: "Press", isHidden: true })];
    expect(buyableTiers(rows, { now: NOW }).map((t) => t.id)).toEqual(["t1"]);
    expect(buyableTiers(rows, { now: NOW, reveal: "press" }).map((t) => t.id)).toEqual(
      ["t1", "press"],
    );
    // And naming one hidden band does not reveal the others.
    const three = [...rows, tier({ id: "comp", name: "Comp", isHidden: true })];
    expect(buyableTiers(three, { now: NOW, reveal: "press" }).map((t) => t.id)).toEqual(
      ["t1", "press"],
    );
  });

  /*
   * A closed band is dropped rather than struck through, and the difference is
   * what the buyer is told: early bird that ended on Friday is over, not sold
   * out, and a struck-through row would say the wrong thing about why.
   */
  it("drops a band outside its own sell window", () => {
    expect(
      buyableTiers([tier({ sellFrom: later(1) })], { now: NOW }),
    ).toHaveLength(0);
    expect(
      buyableTiers([tier({ sellUntil: later(-1) })], { now: NOW }),
    ).toHaveLength(0);
    // Open at both ends, and the boundary belongs to the seller's window.
    expect(
      buyableTiers([tier({ sellFrom: later(-1), sellUntil: later(1) })], { now: NOW }),
    ).toHaveLength(1);
  });

  it("never sends a seller's own counters to a public page", () => {
    const [row] = buyableTiers([tier({ sold: 7 })], { now: NOW });
    expect(row).not.toHaveProperty("sold");
    expect(row).not.toHaveProperty("capacity");
  });
});

describe("the dates a buyer may pick between", () => {
  it("drops a date that has already started", () => {
    expect(
      buyableSessions([session({ startsAt: later(-1) })], NOW),
    ).toHaveLength(0);
    expect(buyableSessions([session({ startsAt: later(1) })], NOW)).toHaveLength(1);
  });

  /*
   * A cancelled date stays, and says so. Somebody holding a ticket for it is
   * the person most likely to be on this page, and an absence answers none of
   * their questions.
   */
  it("keeps a cancelled date listed and marks it", () => {
    const [off] = buyableSessions([session({ isCancelled: true })], NOW);
    expect(off).toMatchObject({ cancelled: true });
  });

  it("counts each date's own seats rather than the room's", () => {
    const rows = buyableSessions(
      [
        session({ id: "tue", capacity: 8, sold: 8 }),
        session({ id: "thu", capacity: 8, sold: 1 }),
      ],
      NOW,
    );
    expect(rows).toMatchObject([
      { id: "tue", soldOut: true, seatsLeft: 0 },
      { id: "thu", soldOut: false, seatsLeft: 7 },
    ]);
  });
});
