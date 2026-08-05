import { describe, expect, it } from "vitest";
import {
  DELIVERY_METHOD_DEFS,
  DELIVERY_METHOD_LIST,
  DELIVERY_METHOD_TYPES,
  isDeliveryConfigured,
  isDeliveryMethodType,
} from "@/lib/delivery";

describe("delivery methods", () => {
  it("recognises only the types it ships", () => {
    for (const t of DELIVERY_METHOD_TYPES) expect(isDeliveryMethodType(t)).toBe(true);
    expect(isDeliveryMethodType("teleport")).toBe(false);
  });

  it("defines both kinds", () => {
    expect(DELIVERY_METHOD_LIST).toHaveLength(DELIVERY_METHOD_TYPES.length);
    for (const def of DELIVERY_METHOD_LIST) {
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
    }
  });

  it("distinguishes shipping from collection", () => {
    expect(DELIVERY_METHOD_DEFS.shipping.type).toBe("shipping");
    expect(DELIVERY_METHOD_DEFS.collection.type).toBe("collection");
  });
});

describe("isDeliveryConfigured", () => {
  it("accepts shipping with nothing extra", () => {
    // A shipping rate needs a name and a fee, both of which are columns.
    expect(isDeliveryConfigured("shipping", {})).toBe(true);
  });

  it("wants an address before it will offer collection", () => {
    // "Collect in store" with no store to collect from strands the buyer.
    expect(isDeliveryConfigured("collection", {})).toBe(false);
    expect(isDeliveryConfigured("collection", { address: "12 Kiln Rd" })).toBe(true);
  });

  it("rejects a type it doesn't know", () => {
    expect(isDeliveryConfigured("drone", {})).toBe(false);
  });
});
