import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_EVENTS,
  notificationPrefsSchema,
  wantsNotification,
} from "./notification-prefs";

/**
 * The one rule this column lives or dies by: **absence means on.**
 *
 * It is what lets a new event type ship enabled for every existing shop with
 * no backfill — and it is also the rule that is easy to invert by accident,
 * because "the pref is not set" reads naturally as "the seller has not opted
 * in". Getting it backwards would silently stop every notification for every
 * shop that has never opened the settings page, which is most of them.
 */

describe("a missing preference means the seller wants the email", () => {
  it("says yes for a shop that has never touched the settings", () => {
    for (const event of NOTIFICATION_EVENTS) {
      expect(wantsNotification({}, event)).toBe(true);
    }
  });

  it("says yes for a key this build has never heard of being present", () => {
    // A pref written by a newer build must not turn off an older build's mail.
    expect(wantsNotification({ somethingNew: false }, "orderPlaced")).toBe(true);
  });

  it("only says no to a literal false", () => {
    expect(wantsNotification({ orderPlaced: false }, "orderPlaced")).toBe(false);
    expect(wantsNotification({ orderPlaced: true }, "orderPlaced")).toBe(true);
  });

  it("survives whatever jsonb hands back", () => {
    /*
     * The column is `jsonb`, so its contents are only as trustworthy as every
     * build that has ever written it. Anything unreadable falls back to
     * sending, because failing to notify a seller of a sale is the worse of
     * the two ways to be wrong.
     */
    for (const junk of [null, undefined, "off", 7, []]) {
      expect(wantsNotification(junk, "orderPlaced")).toBe(true);
    }
  });
});

describe("what may be written to the column", () => {
  it("accepts the known events", () => {
    const parsed = notificationPrefsSchema.safeParse({ orderPlaced: false });
    expect(parsed.success).toBe(true);
  });

  it("rejects a key it does not know", () => {
    // `strictObject`, so a crafted field name is refused at the boundary
    // rather than stored in the column forever.
    const parsed = notificationPrefsSchema.safeParse({ ownerEmail: false });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-boolean value", () => {
    const parsed = notificationPrefsSchema.safeParse({ orderPlaced: "no" });
    expect(parsed.success).toBe(false);
  });

  it("lists every schema key in NOTIFICATION_EVENTS", () => {
    // The form iterates the array; the schema guards the write. A key in one
    // and not the other is a switch that renders but never saves.
    expect(NOTIFICATION_EVENTS.toSorted()).toEqual(
      Object.keys(notificationPrefsSchema.shape).toSorted(),
    );
  });
});
