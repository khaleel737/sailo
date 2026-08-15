import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The rule that decides whether a buyer sees a broken button.
 *
 * This lived inside a `"use server"` function until the phone needed it, which
 * meant it was a rule about *the web form* rather than about the shop. The one
 * that matters is the refusal: **a rail may not be enabled while a field it
 * needs is blank.** A half-configured rail is worse than a missing one — the
 * storefront renders a button, the buyer taps it and lands nowhere, and the
 * seller's own admin shows the toggle as on, so nothing about their screen
 * suggests anything is wrong.
 *
 * Tested against the real `./rails` rather than a stubbed one. The definitions
 * are what say which fields are required, so a test that mocked them would be
 * asserting that a mock was consulted — the assertion that survives somebody
 * deleting the check.
 */

const findMany = vi.fn();

/** Every row written, in order, so an upsert can be read back. */
let inserted: { values: unknown; conflict: unknown }[];
let deleted: unknown[];
/** What the `max(position)` aggregate answers with. */
let maxPosition = "0";

function thenable<T>(result: T, extra: Record<string, unknown> = {}) {
  return { ...extra, then: (resolve: (value: T) => unknown) => resolve(result) };
}

vi.mock("@sailo/db", () => ({
  getDb: () => ({
    query: { paymentMethods: { findMany } },
    select: () => ({
      from: () => ({ where: () => thenable([{ max: maxPosition }]) }),
    }),
    insert: () => ({
      values: (values: unknown) => ({
        onConflictDoUpdate: (conflict: unknown) => {
          inserted.push({ values, conflict });
          return thenable(undefined);
        },
      }),
    }),
    delete: () => ({
      where: (where: unknown) => ({
        returning: () => {
          deleted.push(where);
          return thenable([{ type: "venmo" }]);
        },
      }),
    }),
  }),
}));

const { listRails, saveRail, deleteRail } = await import("./rail-settings");

const SHOP = {
  id: "shop-1",
  currency: "USD",
  stripeAccountId: null,
  stripeChargesEnabled: false,
};

beforeEach(() => {
  inserted = [];
  deleted = [];
  maxPosition = "0";
  findMany.mockResolvedValue([]);
});

describe("saveRail", () => {
  it("refuses to enable a rail whose required field is blank", async () => {
    const result = await saveRail({
      shopId: SHOP.id,
      type: "whatsapp",
      config: {},
      isEnabled: true,
      label: null,
    });

    expect(result).toEqual({ ok: false, reason: "unconfigured", missing: ["phone"] });
    // Nothing written — a refusal that still saved would be the same bug.
    expect(inserted).toHaveLength(0);
  });

  it("allows the same rail to be saved while it stays off", async () => {
    /*
     * Half-filling a rail is how a seller works: they paste a number, get
     * interrupted, come back. Refusing the save because it is incomplete would
     * lose what they had typed — the refusal is about *enabling*, not about
     * storing.
     */
    const result = await saveRail({
      shopId: SHOP.id,
      type: "whatsapp",
      config: {},
      isEnabled: false,
      label: null,
    });

    expect(result).toEqual({ ok: true, type: "whatsapp" });
    expect(inserted).toHaveLength(1);
  });

  it("keeps only the fields the rail actually defines", async () => {
    /*
     * The column is `jsonb`, so it would accept anything the client sent. The
     * phone builds this object itself rather than posting a form, so "whatever
     * arrived" is genuinely arbitrary — and arbitrary keys under a seller's
     * payment settings are read back out by the storefront.
     */
    await saveRail({
      shopId: SHOP.id,
      type: "whatsapp",
      config: { phone: "234801234567", note: "ignore me" } as Record<string, string>,
      isEnabled: true,
      label: null,
    });

    expect(inserted).toHaveLength(1);
    expect((inserted[0]?.values as { config: Record<string, string> }).config).toEqual({
      phone: "234801234567",
    });
  });

  it("appends after the seller's existing rails rather than jumping the queue", async () => {
    // `position` decides the order the buttons appear in on the storefront.
    // Defaulting a new rail to 0 would silently promote it above everything
    // the seller had already arranged.
    maxPosition = "4";

    await saveRail({
      shopId: SHOP.id,
      type: "whatsapp",
      config: { phone: "234801234567" },
      isEnabled: true,
      label: null,
    });

    expect((inserted[0]?.values as { position: number }).position).toBe(5);
  });

  it("does not move a rail that is only being edited", async () => {
    // The upsert's update branch deliberately omits `position`, so re-saving a
    // rail cannot reorder the storefront under a buyer mid-checkout.
    await saveRail({
      shopId: SHOP.id,
      type: "whatsapp",
      config: { phone: "234801234567" },
      isEnabled: true,
      label: null,
    });

    const { set } = inserted[0]?.conflict as { set: Record<string, unknown> };
    expect(set).not.toHaveProperty("position");
  });

  it("answers 'unknown' for a type that is not a rail", async () => {
    const result = await saveRail({
      shopId: SHOP.id,
      type: "bitcoin",
      config: {},
      isEnabled: true,
      label: null,
    });

    expect(result).toEqual({ ok: false, reason: "unknown" });
    expect(inserted).toHaveLength(0);
  });

  it("trims a blank label to null rather than storing an empty string", async () => {
    // `label` is the seller's override for the button text, and `""` is not an
    // override — it is a button with no words on it.
    await saveRail({
      shopId: SHOP.id,
      type: "whatsapp",
      config: { phone: "234801234567" },
      isEnabled: false,
      label: "   ",
    });

    expect((inserted[0]?.values as { label: string | null }).label).toBeNull();
  });
});

describe("listRails", () => {
  it("offers every rail, not only the ones already switched on", async () => {
    // A settings screen has to show a seller what they have *not* turned on,
    // and the table only knows about the ones they have.
    findMany.mockResolvedValue([]);

    const rails = await listRails(SHOP);

    expect(rails.length).toBeGreaterThan(5);
    expect(rails.every((rail) => rail.isEnabled === false)).toBe(true);
  });

  it("tells 'not filled in' apart from 'cannot work in your currency'", async () => {
    /*
     * The distinction a seller needs and a single boolean cannot carry: one is
     * work they can do, the other is not. Venmo settles dollars only, so in a
     * euro shop a fully configured Venmo is still unusable — and the screen has
     * to say why rather than showing them an empty form to fill in again.
     */
    findMany.mockResolvedValue([
      {
        type: "venmo",
        label: null,
        config: { venmoHandle: "sailo-shop" },
        isEnabled: true,
        position: 1,
      },
    ]);

    const euro = await listRails({ ...SHOP, currency: "EUR" });
    const venmo = euro.find((rail) => rail.type === "venmo");

    expect(venmo?.configured).toBe(true);
    expect(venmo?.available).toBe(false);
    expect(venmo?.usable).toBe(false);
  });

  it("holds card unusable until Stripe has actually cleared the account", async () => {
    /*
     * Card has no fields, so `isConfigured` always says yes. What makes it
     * usable is a connected account Stripe has cleared for charges — a seller
     * mid-onboarding is connected and not payable, and offering the button then
     * sends buyers into an error.
     */
    findMany.mockResolvedValue([
      { type: "card", label: null, config: {}, isEnabled: true, position: 1 },
    ]);

    const connecting = await listRails({
      ...SHOP,
      stripeAccountId: "acct_1",
      stripeChargesEnabled: false,
    });
    expect(connecting.find((rail) => rail.type === "card")?.usable).toBe(false);

    const cleared = await listRails({
      ...SHOP,
      stripeAccountId: "acct_1",
      stripeChargesEnabled: true,
    });
    expect(cleared.find((rail) => rail.type === "card")?.usable).toBe(true);
  });
});

describe("deleteRail", () => {
  it("refuses a type that is not a rail rather than running the delete", async () => {
    expect(await deleteRail(SHOP.id, "bitcoin")).toBe(false);
    expect(deleted).toHaveLength(0);
  });
});
