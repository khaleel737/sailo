import { describe, expect, it } from "vitest";
import { WEBHOOK_EVENTS, knownEvents, isWebhookEvent, envelope } from "./events";

/**
 * The event catalogue, and the envelope every delivery is wrapped in.
 *
 * The other half of this file — the assertions about *where* an event is raised
 * from — went back to `apps/web/src/lib/webhook-emit-sites.test.ts`, where four
 * of the five call sites it reads live. A source scan cannot follow its subjects
 * across a package boundary, and one that silently finds nothing is worse than
 * one that is not there.
 */

describe("the catalogue", () => {
  it("recognises its own names and nothing else", () => {
    for (const event of WEBHOOK_EVENTS) expect(isWebhookEvent(event)).toBe(true);
    for (const value of ["order.deleted", "", null, undefined, 7, "ORDER.PAID"]) {
      expect(isWebhookEvent(value)).toBe(false);
    }
  });

  it("drops stale subscriptions on read", () => {
    /*
     * `events` is a text[] a form wrote, and a name we later rename would sit
     * in it for ever matching nothing. Filtering on read makes a stale name
     * inert rather than a permanent, silent subscription.
     */
    expect(knownEvents(["order.paid", "order.teleported", "contact.created"])).toEqual([
      "order.paid",
      "contact.created",
    ]);
    expect(knownEvents([])).toEqual([]);
  });
});

describe("envelope", () => {
  const shop = { id: "shop-1", handle: "acme" };
  const now = new Date("2026-08-12T09:41:07.221Z");

  it("puts the delivery id in the body as well as the header", () => {
    // A consumer is told to dedupe on `webhook-id`; the body copy is what a
    // no-code tool can actually see.
    const built = envelope({ id: "d-1", event: "order.paid", shop, data: {}, now });
    expect(built.id).toBe("d-1");
    expect(built.timestamp).toBe("2026-08-12T09:41:07.221Z");
    expect(built.shop).toEqual({ id: "shop-1", handle: "acme" });
  });

  it("always carries `test`, so a mapping built on a test payload still fits", () => {
    const real = envelope({ id: "d", event: "order.paid", shop, data: {}, now });
    const trial = envelope({ id: "d", event: "order.paid", shop, data: {}, now, test: true });
    expect(real.test).toBe(false);
    expect(trial.test).toBe(true);
    expect(Object.keys(real).toSorted()).toEqual(Object.keys(trial).toSorted());
  });
});
