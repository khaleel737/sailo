import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NOTIFICATION_EVENTS } from "@sailo/notifications/prefs";

/**
 * Every notification event has a switch, and the switch saves.
 *
 * ## Why this is a test and not a code review
 *
 * `readNotificationPrefs` iterates `NOTIFICATION_EVENTS` and writes `false` for
 * every switch the form did not submit — which is the right shape, because an
 * unchecked box is simply absent from a `FormData` and "absence means on" is
 * what lets a new event ship without a migration.
 *
 * The consequence is that an event in the array with **no row in the card** is
 * not a missing feature. It is a notification that gets turned **off** the next
 * time the seller saves anything at all on that page, silently, without them
 * touching it. The switch they never saw is the switch that disabled their mail.
 *
 * That is exactly what happened: `taxThreshold` and `lowStock` were added to the
 * array by two different waves and neither added a row, and `leadCaptured` had a
 * schema key and a live sender and was in neither. Three events, one shipped
 * behaviour — a seller opening Settings to change their shop name quietly stopped
 * being told they were running out of stock.
 *
 * A source-text assertion, in the idiom `notify-seller-sites.test.ts` uses,
 * because the property is about which strings appear in a file. Rendering the
 * card would need a React environment and would still only prove the six rows
 * that exist render — not that the two which do not are missing.
 */

const CARD = readFileSync(
  "src/app/admin/settings/_components/notifications-card.tsx",
  "utf8",
);

describe("the notifications card", () => {
  it.each(NOTIFICATION_EVENTS)("has a switch for %s", (event) => {
    /*
     * `event: "name"` rather than the bare name — the string appears in the
     * i18n key too (`notifyLowStock`), and matching that would pass for an
     * event whose label exists and whose row does not.
     */
    expect(CARD).toContain(`event: "${event}"`);
  });

  it("has no switch for an event that is not in the array", () => {
    /*
     * The other direction, and it fails differently: a row whose event was
     * removed from `NOTIFICATION_EVENTS` renders a switch that `readNotification
     * Prefs` never reads, so the seller turns something off and it comes back on
     * when the page reloads.
     */
    const rendered = [...CARD.matchAll(/event: "([a-zA-Z]+)"/g)].map((m) => m[1]);
    expect(rendered.toSorted()).toEqual([...NOTIFICATION_EVENTS].toSorted());
  });

  it("saves every switch it renders", () => {
    /*
     * The name attribute is the other half of the pair. `readNotificationPrefs`
     * looks for `notify_${event}`, so a row whose `name` does not follow that
     * shape renders, accepts a click, and is discarded on save — which is the
     * same silent failure from the opposite side.
     */
    expect(CARD).toContain("name={`notify_${row.event}`}");
  });
});
