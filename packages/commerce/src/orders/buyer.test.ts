import { describe, expect, it } from "vitest";
import { readBuyer } from "./buyer";

/**
 * What an order has to carry before a seller can act on it.
 *
 * There is a floor under every order — a name and one way to reach the buyer —
 * and the rail and the goods each add to it. These pin the three rules that
 * decide whether an order can be fulfilled at all: someone to name, someone
 * reachable, and — only when something is being sent — somewhere to send it.
 */

const NEEDS_NOTHING = { requires: { email: false } };
const NEEDS_EMAIL = { requires: { email: true } };

/** The floor, so a test about one rule isn't tripped by another. */
const SAM = { customerName: "Sam", customerEmail: "sam@example.com" };

const ok = (r: ReturnType<typeof readBuyer>) => {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.buyer;
};

describe("readBuyer — the floor under every order", () => {
  it("refuses an order from nobody", () => {
    /*
     * The name reaches the order list, the seller's notification and the
     * packing slip. Without it all three said "order from —", and the seller
     * had no way to tell two of them apart.
     */
    const r = readBuyer({ customerEmail: "sam@example.com" }, { def: NEEDS_NOTHING, wantsAddress: false });
    expect(r.ok).toBe(false);
  });

  it("refuses an order nobody can be reached about, on every rail", () => {
    /*
     * The chat rails ask for nothing of their own, on the reasoning that
     * WhatsApp identifies the buyer by itself. The order row is written
     * *before* the handoff, so a buyer who never presses send used to leave an
     * order from a stranger that no one could chase.
     */
    const r = readBuyer({ customerName: "Sam" }, { def: NEEDS_NOTHING, wantsAddress: false });
    expect(r.ok).toBe(false);
  });

  it("takes either way of being reached", () => {
    expect(
      readBuyer({ customerName: "Sam", customerEmail: "a@b.co" }, { def: NEEDS_NOTHING, wantsAddress: false }).ok,
    ).toBe(true);
    expect(
      readBuyer({ customerName: "Sam", customerPhone: "+15551234567" }, { def: NEEDS_NOTHING, wantsAddress: false }).ok,
    ).toBe(true);
  });

  it("treats whitespace as absent, not as an answer", () => {
    // "   " would otherwise satisfy a required field and store nothing useful.
    expect(
      readBuyer({ customerName: "  ", customerEmail: "a@b.co" }, { def: NEEDS_NOTHING, wantsAddress: false }).ok,
    ).toBe(false);
    expect(
      readBuyer({ customerName: "Sam", customerEmail: "   " }, { def: NEEDS_EMAIL, wantsAddress: false }).ok,
    ).toBe(false);
  });

  it("does not let an unusable phone stand in for contact", () => {
    // It reaches nobody, so accepting it would strand the order.
    expect(
      readBuyer({ customerName: "Sam", customerPhone: "not a phone" }, { def: NEEDS_NOTHING, wantsAddress: false }).ok,
    ).toBe(false);
  });
});

describe("readBuyer — what the rail and the goods add", () => {
  it("normalises the email so two spellings are one buyer", () => {
    const b = ok(readBuyer({ customerName: "Sam", customerEmail: "  Sam@Example.COM " }, { def: NEEDS_EMAIL, wantsAddress: false }));
    expect(b.email).toBe("sam@example.com");
  });

  it("refuses a rail that needs an email without one", () => {
    const r = readBuyer({ customerName: "Sam", customerPhone: "+15551234567" }, { def: NEEDS_EMAIL, wantsAddress: false });
    expect(r.ok).toBe(false);
  });

  it("insists on an email when the order arrives in one", () => {
    /*
     * A download link and a ticket are shown on the confirmation screen, which
     * is one closed tab away from being gone. A phone number cannot be sent
     * either of them a second time.
     */
    const phoneOnly = { customerName: "Sam", customerPhone: "+15551234567" };
    expect(readBuyer(phoneOnly, { def: NEEDS_NOTHING, wantsAddress: false, sendsByEmail: true }).ok).toBe(false);
    expect(readBuyer(phoneOnly, { def: NEEDS_NOTHING, wantsAddress: false, sendsByEmail: false }).ok).toBe(true);
  });

  it("stores an unusable phone as absent rather than as text", () => {
    const b = ok(readBuyer(
      { ...SAM, customerPhone: "not a phone" },
      { def: NEEDS_EMAIL, wantsAddress: false },
    ));
    expect(b.phone).toBeNull();
  });

  it("caps every field, so one long paste can't fill the column", () => {
    const b = ok(readBuyer(
      { ...SAM, customerName: "n".repeat(500), note: "x".repeat(2000) },
      { def: NEEDS_EMAIL, wantsAddress: false },
    ));
    expect(b.name?.length).toBeLessThanOrEqual(120);
    expect(b.note?.length).toBeLessThanOrEqual(500);
  });
});

describe("readBuyer — somewhere to deliver it", () => {
  it("refuses a delivery order with nowhere to deliver to", () => {
    /*
     * The panel has always asked for an address on a delivery order, and
     * nothing ever read the answer — so one could be placed with the fields
     * blank, and the seller found out when they came to post it.
     */
    expect(readBuyer(SAM, { def: NEEDS_EMAIL, wantsAddress: true }).ok).toBe(false);
    expect(
      readBuyer({ ...SAM, addressLine1: "1 High St" }, { def: NEEDS_EMAIL, wantsAddress: true }).ok,
    ).toBe(false);
  });

  it("asks for the street and the town, and nothing beyond them", () => {
    // Plenty of real addresses have no postcode and no region, and a required
    // field an honest buyer cannot fill is worse than a blank one.
    const b = ok(readBuyer(
      { ...SAM, addressLine1: "1 High St", city: "Leeds" },
      { def: NEEDS_EMAIL, wantsAddress: true },
    ));
    expect(b.address.addressLine1).toBe("1 High St");
    expect(b.address.postalCode).toBeNull();
    expect(b.address.country).toBeNull();
  });

  it("asks for none of it when there is nothing to deliver", () => {
    expect(readBuyer(SAM, { def: NEEDS_EMAIL, wantsAddress: false }).ok).toBe(true);
  });

  it("drops the address on a collection order", () => {
    /*
     * The buyer may have typed one before switching to collection. Keeping it
     * would leave a delivery address on an order nobody delivers, which reads
     * to the seller as something to post.
     */
    const b = ok(readBuyer(
      { ...SAM, addressLine1: "1 High St", city: "Leeds" },
      { def: NEEDS_EMAIL, wantsAddress: false },
    ));
    expect(b.address.addressLine1).toBeNull();
    expect(b.address.city).toBeNull();
  });

  it("keeps the rest of the address when it is given", () => {
    const b = ok(readBuyer(
      { ...SAM, addressLine1: "1 High St", city: "Leeds", country: "UK" },
      { def: NEEDS_EMAIL, wantsAddress: true },
    ));
    expect(b.address.country).toBe("UK");
  });
});

/**
 * The address a receipt is actually sent to.
 *
 * This value becomes the `to:` on the confirmation, the invoice link and — for
 * a digital order — the download link. Resend takes a JSON body, so a
 * malformed address is not an injection; it is a send that fails quietly. The
 * buyer pays and hears nothing, and the seller sees a completed order and no
 * reason why their customer is asking where the file is.
 */
describe("readBuyer — the email has to be deliverable", () => {
  it("refuses an address that cannot be one", () => {
    for (const email of [
      "sam",
      "sam@",
      "@example.com",
      "sam@example",
      "sam example@test.com",
      "sam@@example.com",
      "sam@.com",
    ]) {
      const r = readBuyer({ customerName: "Sam", customerEmail: email }, { def: NEEDS_EMAIL, wantsAddress: false });
      expect(r.ok, email).toBe(false);
    }
  });

  it("accepts the shapes that are valid but look unusual", () => {
    /*
     * Deliberately loose. Anything stricter rejects real addresses — plus
     * tags, new TLDs, unicode domains — and the only real proof an address
     * works is the mail arriving.
     */
    for (const email of [
      "sam+tag@example.com",
      "sam.o'brien@example.co.uk",
      "sam@sub.domain.example.museum",
      "sam@例え.テスト",
      "s@e.co",
    ]) {
      const r = readBuyer({ customerName: "Sam", customerEmail: email }, { def: NEEDS_EMAIL, wantsAddress: false });
      expect(r.ok, email).toBe(true);
    }
  });

  it("checks a junk email even when a phone would have done", () => {
    // The phone satisfies the contact rule, but a bad address that was typed
    // anyway still gets used for the receipt.
    const r = readBuyer(
      { customerName: "Sam", customerEmail: "not-an-address", customerPhone: "+15551234567" },
      { def: NEEDS_NOTHING, wantsAddress: false },
    );
    expect(r.ok).toBe(false);
  });
});
