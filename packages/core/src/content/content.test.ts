import { describe, expect, it } from "vitest";
import {
  EMBED_HOSTS,
  daysUntil,
  dripDaysFor,
  groupIntoSections,
  isAvailable,
  isEmbeddableUrl,
  isValidPreview,
  opensAt,
  progressFor,
  type ContentCollection,
  type ContentItem,
} from "./index";

/**
 * Gated content, the pure half. Spec 40.
 *
 * Two properties carry this file, and the second is the one the spec is
 * emphatic about:
 *
 *   **Drip is arithmetic, not a stored date.** A stored unlock date is wrong the
 *   moment a seller changes the interval, and wrong in whichever direction
 *   hurts: it either withholds something a buyer paid for or releases it early.
 *
 *   **There is no access predicate in here.** `membershipAccess` and the
 *   download gate decide who may see a collection at all; this decides only
 *   *when* an item a fully entitled buyer already has rights to opens. If a test
 *   in this file ever asserts something about a subscription's status, the spec
 *   has been implemented wrongly.
 */

const item = (over: Partial<ContentItem> = {}): ContentItem => ({
  id: "item-1",
  section: null,
  title: "Lesson one",
  position: 0,
  isPreview: false,
  availableAfterDays: null,
  hasFile: true,
  ...over,
});

const dripping = (days: number | null): ContentCollection => ({
  dripMode: days === null ? "none" : "interval",
  dripIntervalDays: days,
});

const ANCHOR = new Date("2026-08-01T09:00:00.000Z");

/* -------------------------------------------------------------------------- */

describe("ordering and grouping", () => {
  it("keeps the seller's order and follows it into the sections", () => {
    /*
     * Sections appear in the order their first item does. Sorting the names
     * alphabetically would mean renaming "Week 1" to "Part one" silently
     * reordered somebody's course.
     */
    const sections = groupIntoSections([
      item({ id: "c", section: "Week 2", position: 3 }),
      item({ id: "a", section: "Week 1", position: 1 }),
      item({ id: "b", section: "Week 1", position: 2 }),
    ]);

    expect(sections.map((section) => section.section)).toEqual(["Week 1", "Week 2"]);
    expect(sections[0]?.items.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("puts ungrouped items first", () => {
    // A seller who has not used sections has one implicit group and it is the
    // whole course; burying the introduction under the labelled weeks is wrong.
    const sections = groupIntoSections([
      item({ id: "intro", section: null, position: 0 }),
      item({ id: "w1", section: "Week 1", position: 1 }),
    ]);
    expect(sections[0]?.section).toBeNull();
  });

  it("treats a blank section label as no label", () => {
    const sections = groupIntoSections([
      item({ id: "a", section: "  ", position: 0 }),
      item({ id: "b", section: null, position: 1 }),
    ]);
    expect(sections).toHaveLength(1);
  });

  it("breaks a position tie by title rather than by insertion order", () => {
    // Two items a seller never reordered must render the same way twice.
    const sections = groupIntoSections([
      item({ id: "b", title: "Beta", position: 0 }),
      item({ id: "a", title: "Alpha", position: 0 }),
    ]);
    expect(sections[0]?.items.map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});

/* -------------------------------------------------------------------------- */

describe("drip", () => {
  it("opens everything at once when there is no drip", () => {
    expect(dripDaysFor(dripping(null), item())).toBe(0);
    expect(isAvailable(dripping(null), item(), ANCHOR, ANCHOR)).toBe(true);
  });

  it("waits the collection's interval", () => {
    const collection = dripping(7);
    expect(opensAt(collection, item(), ANCHOR).toISOString()).toBe(
      "2026-08-08T09:00:00.000Z",
    );
    expect(isAvailable(collection, item(), ANCHOR, new Date("2026-08-07T23:59:00.000Z"))).toBe(false);
    expect(isAvailable(collection, item(), ANCHOR, new Date("2026-08-08T09:00:00.000Z"))).toBe(true);
  });

  it("lets an item override the collection", () => {
    const collection = dripping(7);
    expect(dripDaysFor(collection, item({ availableAfterDays: 2 }))).toBe(2);
  });

  it("treats an override of zero as immediate, not as absent", () => {
    /*
     * Blank ≠ zero. `0` is a seller saying "this one opens immediately even
     * though the rest drip"; `null` is a seller who has said nothing about this
     * item and means the collection's interval.
     */
    const collection = dripping(7);
    expect(dripDaysFor(collection, item({ availableAfterDays: 0 }))).toBe(0);
    expect(dripDaysFor(collection, item({ availableAfterDays: null }))).toBe(7);
  });

  it("counts whole days from the moment access began, not from midnight", () => {
    /*
     * A buyer who bought at 23:50 waits a day, not ten minutes — and two buyers
     * on the same calendar day get the same answer wherever the server thinks
     * they are, which anchoring on a local midnight would not give.
     */
    const late = new Date("2026-08-01T23:50:00.000Z");
    expect(opensAt(dripping(1), item(), late).toISOString()).toBe(
      "2026-08-02T23:50:00.000Z",
    );
  });

  it("opens a preview whatever the drip says", () => {
    const collection = dripping(30);
    expect(isAvailable(collection, item({ isPreview: true }), ANCHOR, ANCHOR)).toBe(true);
    // And with no anchor at all, which is the whole point of a preview.
    expect(isAvailable(collection, item({ isPreview: true }), null, ANCHOR)).toBe(true);
  });

  it("opens nothing without an anchor", () => {
    /*
     * No anchor means access has not begun. The gate has already refused in that
     * case; this refuses too, so a caller that asks only this question cannot
     * open an item by forgetting the other one.
     */
    expect(isAvailable(dripping(null), item(), null, ANCHOR)).toBe(false);
  });

  it("counts down, and stops counting once open", () => {
    const collection = dripping(7);
    expect(daysUntil(collection, item(), ANCHOR, new Date("2026-08-02T09:00:00.000Z"))).toBe(6);
    expect(daysUntil(collection, item(), ANCHOR, new Date("2026-08-09T09:00:00.000Z"))).toBeNull();
    expect(daysUntil(collection, item({ isPreview: true }), ANCHOR, ANCHOR)).toBeNull();
  });

  it("survives a negative interval", () => {
    // A seller typing -3 must not make an item open before the sale.
    expect(dripDaysFor({ dripMode: "interval", dripIntervalDays: -3 }, item())).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

describe("progress", () => {
  const three = [
    item({ id: "a", position: 0 }),
    item({ id: "b", position: 1 }),
    item({ id: "c", position: 2 }),
  ];

  it("counts completions and names the next one", () => {
    const progress = progressFor(three, [
      { itemId: "a", completedAt: new Date() },
      { itemId: "b", completedAt: null },
    ]);
    expect(progress).toEqual({
      total: 3,
      completed: 1,
      percent: 33,
      nextItemId: "b",
    });
  });

  it("is zero for an empty collection, never a hundred", () => {
    /*
     * An empty collection is a seller who has not finished building it. Telling
     * the buyer they completed it is the wrong answer in the one case where they
     * might otherwise write in and say so.
     */
    expect(progressFor([], [])).toEqual({
      total: 0,
      completed: 0,
      percent: 0,
      nextItemId: null,
    });
  });

  it("counts previews towards completion for somebody who paid", () => {
    // They are lesson one. Excluding them shows 80% to a buyer who has finished
    // everything.
    const withPreview = [item({ id: "p", isPreview: true, position: 0 }), item({ id: "a", position: 1 })];
    const progress = progressFor(withPreview, [
      { itemId: "p", completedAt: new Date() },
      { itemId: "a", completedAt: new Date() },
    ]);
    expect(progress.percent).toBe(100);
    expect(progress.nextItemId).toBeNull();
  });

  it("ignores progress on an item that is not in the list", () => {
    // An item the seller deleted, or one that has not dripped yet. A percentage
    // over 100 would be arithmetic nobody can explain.
    const progress = progressFor(three, [
      { itemId: "a", completedAt: new Date() },
      { itemId: "gone", completedAt: new Date() },
    ]);
    expect(progress.completed).toBe(1);
    expect(progress.percent).toBe(33);
  });

  it("takes the next item in the seller's order, not the input's", () => {
    const progress = progressFor(
      [item({ id: "c", position: 2 }), item({ id: "a", position: 0 })],
      [],
    );
    expect(progress.nextItemId).toBe("a");
  });
});

/* -------------------------------------------------------------------------- */

describe("embeds", () => {
  it.each(EMBED_HOSTS)("accepts https://%s/…", (host) => {
    expect(isEmbeddableUrl(`https://${host}/watch?v=abc`)).toBe(true);
  });

  it.each([
    ["http://youtube.com/watch?v=abc", "plain http"],
    ["https://evil.example/watch", "a host that is not on the list"],
    ["https://youtube.com.evil.example/x", "a lookalike host"],
    ["javascript:alert(1)", "a script URL"],
    ["not a url", "nonsense"],
  ])("refuses %s (%s)", (url) => {
    expect(isEmbeddableUrl(url)).toBe(false);
  });
});

describe("previews", () => {
  it("refuses to make a file item a preview", () => {
    /*
     * THE ONE PLACE A MISTAKE HANDS THE GOODS OVER. A preview is readable with
     * no order at all — that is what it is for — so a preview carrying a file is
     * a paid file given away to anybody with the link.
     */
    expect(isValidPreview({ isPreview: true, hasFile: true })).toBe(false);
    expect(isValidPreview({ isPreview: true, hasFile: false })).toBe(true);
    // And an ordinary item may carry a file, obviously.
    expect(isValidPreview({ isPreview: false, hasFile: true })).toBe(true);
  });
});
