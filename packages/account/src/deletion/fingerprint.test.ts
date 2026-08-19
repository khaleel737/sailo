import { describe, expect, it } from "vitest";
import { closureFingerprint } from "./fingerprint";

/**
 * The one column that has to survive a deletion request, so the properties that
 * make it survivable are the ones asserted here.
 */

const KEY = "test-secret";

describe("closureFingerprint", () => {
  it("is stable for the same address and key", () => {
    expect(closureFingerprint("ada@example.com", KEY)).toBe(
      closureFingerprint("ada@example.com", KEY),
    );
  });

  it("ignores the case and whitespace a form leaves behind", () => {
    // The address arrives from `user.email`, which is stored as the person
    // typed it. A digest that depended on that would never match a signup.
    const canonical = closureFingerprint("ada@example.com", KEY);
    expect(closureFingerprint("  ADA@Example.COM  ", KEY)).toBe(canonical);
  });

  it("does not normalise Gmail aliasing", () => {
    /*
     * `a.da@gmail.com` reaches the same inbox and is a different account to
     * register with. Folding them together would make one person's return
     * indistinguishable from a stranger's arrival — and the same argument runs
     * the other way in `isStaffEmail`, where folding would let an alias in.
     */
    const plain = closureFingerprint("ada@gmail.com", KEY);
    expect(closureFingerprint("a.da@gmail.com", KEY)).not.toBe(plain);
    expect(closureFingerprint("ada+shop@gmail.com", KEY)).not.toBe(plain);
  });

  it("produces a different digest under a different key", () => {
    // The property that makes a leaked copy of the table useless on its own.
    expect(closureFingerprint("ada@example.com", "other-secret")).not.toBe(
      closureFingerprint("ada@example.com", KEY),
    );
  });

  it("reveals nothing about the address in the output", () => {
    const digest = closureFingerprint("ada@example.com", KEY);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain("ada");
    expect(digest).not.toContain("example");
  });

  it("refuses an address that is already a tombstone", () => {
    /*
     * A retried deletion reaches this after the first run has overwritten the
     * address. Hashing the placeholder would file every such closure under one
     * digest and report them all as the same returning person.
     */
    expect(closureFingerprint("deleted-abc@sailo.invalid", KEY)).toBeNull();
  });

  it.each([null, undefined, "", "   "])("refuses %j", (value) => {
    expect(closureFingerprint(value, KEY)).toBeNull();
  });
});
