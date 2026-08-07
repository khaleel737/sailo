import { describe, expect, it } from "vitest";
import { readBuyer } from "./buyer";

/**
 * What a payment rail asks of the buyer, read from the rail rather than
 * guessed from its kind. These pin the two rules that decide whether an order
 * can be fulfilled at all: someone reachable, and — only when there is
 * something to deliver — somewhere to deliver it.
 */

const NEEDS_NOTHING = { requires: { email: false, contact: false } };
const NEEDS_EMAIL = { requires: { email: true, contact: false } };
const NEEDS_CONTACT = { requires: { email: false, contact: true } };

const ok = (r: ReturnType<typeof readBuyer>) => {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.buyer;
};

describe("readBuyer", () => {
  it("normalises the email so two spellings are one buyer", () => {
    const b = ok(readBuyer({ customerEmail: "  Sam@Example.COM " }, { def: NEEDS_EMAIL, wantsAddress: false }));
    expect(b.email).toBe("sam@example.com");
  });

  it("refuses a rail that needs an email without one", () => {
    const r = readBuyer({ customerPhone: "+15551234567" }, { def: NEEDS_EMAIL, wantsAddress: false });
    expect(r.ok).toBe(false);
  });

  it("accepts either way of reaching the buyer when the rail wants contact", () => {
    // A bank transfer settles later, so the seller needs some way to follow up.
    expect(readBuyer({ customerEmail: "a@b.co" }, { def: NEEDS_CONTACT, wantsAddress: false }).ok).toBe(true);
    expect(readBuyer({ customerPhone: "+15551234567" }, { def: NEEDS_CONTACT, wantsAddress: false }).ok).toBe(true);
    expect(readBuyer({}, { def: NEEDS_CONTACT, wantsAddress: false }).ok).toBe(false);
  });

  it("lets an anonymous buyer through a rail that asks for nothing", () => {
    expect(readBuyer({}, { def: NEEDS_NOTHING, wantsAddress: false }).ok).toBe(true);
  });

  it("treats whitespace as absent, not as an answer", () => {
    // "   " would otherwise satisfy a required field and store nothing useful.
    expect(readBuyer({ customerEmail: "   " }, { def: NEEDS_EMAIL, wantsAddress: false }).ok).toBe(false);
  });

  it("drops the address on a collection order", () => {
    /*
     * The buyer may have typed one before switching to collection. Keeping it
     * would leave a delivery address on an order nobody delivers, which reads
     * to the seller as something to post.
     */
    const b = ok(readBuyer(
      { customerEmail: "a@b.co", addressLine1: "1 High St", city: "Leeds" },
      { def: NEEDS_EMAIL, wantsAddress: false },
    ));
    expect(b.address.addressLine1).toBeNull();
    expect(b.address.city).toBeNull();
  });

  it("keeps the address when there is something to deliver", () => {
    const b = ok(readBuyer(
      { customerEmail: "a@b.co", addressLine1: "1 High St", city: "Leeds", country: "UK" },
      { def: NEEDS_EMAIL, wantsAddress: true },
    ));
    expect(b.address.addressLine1).toBe("1 High St");
    expect(b.address.country).toBe("UK");
  });

  it("caps every field, so one long paste can't fill the column", () => {
    const b = ok(readBuyer(
      { customerName: "n".repeat(500), note: "x".repeat(2000), customerEmail: "a@b.co" },
      { def: NEEDS_EMAIL, wantsAddress: false },
    ));
    expect(b.name?.length).toBeLessThanOrEqual(120);
    expect(b.note?.length).toBeLessThanOrEqual(500);
  });

  it("stores an unusable phone as absent rather than as text", () => {
    const b = ok(readBuyer(
      { customerEmail: "a@b.co", customerPhone: "not a phone" },
      { def: NEEDS_EMAIL, wantsAddress: false },
    ));
    expect(b.phone).toBeNull();
  });

  it("does not let an unusable phone satisfy a contact requirement", () => {
    // It reaches nobody, so accepting it would strand the order.
    expect(
      readBuyer({ customerPhone: "not a phone" }, { def: NEEDS_CONTACT, wantsAddress: false }).ok,
    ).toBe(false);
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
      const r = readBuyer({ customerEmail: email }, { def: NEEDS_EMAIL, wantsAddress: false });
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
      const r = readBuyer({ customerEmail: email }, { def: NEEDS_EMAIL, wantsAddress: false });
      expect(r.ok, email).toBe(true);
    }
  });

  it("still lets a rail that wants no email through without one", () => {
    // The check only fires on a value that exists; absence is a separate rule.
    const r = readBuyer({ customerPhone: "+15551234567" }, { def: NEEDS_CONTACT, wantsAddress: false });
    expect(r.ok).toBe(true);
  });

  it("checks a junk email even on a rail that only wants contact", () => {
    // A phone would satisfy `requires.contact`, but a bad address that was
    // typed anyway still gets used for the receipt.
    const r = readBuyer(
      { customerEmail: "not-an-address", customerPhone: "+15551234567" },
      { def: NEEDS_CONTACT, wantsAddress: false },
    );
    expect(r.ok).toBe(false);
  });
});
