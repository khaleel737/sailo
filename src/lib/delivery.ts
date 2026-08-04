import type { DeliveryConfig } from "@/db/schema";

export const DELIVERY_METHOD_TYPES = ["shipping", "collection"] as const;
export type DeliveryMethodType = (typeof DELIVERY_METHOD_TYPES)[number];

export type DeliveryFieldKey = keyof DeliveryConfig;

export type DeliveryMethodDef = {
  type: DeliveryMethodType;
  name: string;
  description: string;
  /** Whether choosing this asks the buyer for an address. */
  needsAddress: boolean;
  fields: {
    key: DeliveryFieldKey;
    label: string;
    placeholder?: string;
    multiline?: boolean;
  }[];
};

export const DELIVERY_METHOD_DEFS: Record<
  DeliveryMethodType,
  DeliveryMethodDef
> = {
  shipping: {
    type: "shipping",
    name: "Shipping",
    description: "You post or courier the order to the buyer's address.",
    needsAddress: true,
    fields: [
      {
        key: "estimate",
        label: "Delivery estimate",
        placeholder: "2–3 working days",
      },
      {
        key: "instructions",
        label: "Notes for the buyer",
        placeholder: "We ship every Tuesday and Friday.",
        multiline: true,
      },
    ],
  },
  collection: {
    type: "collection",
    name: "Collection",
    description: "The buyer picks the order up from you.",
    needsAddress: false,
    fields: [
      {
        key: "address",
        label: "Pickup address",
        placeholder: "12 Marina Road, Lagos",
        multiline: true,
      },
      {
        key: "hours",
        label: "Opening hours",
        placeholder: "Mon–Fri, 10am–6pm",
      },
      {
        key: "instructions",
        label: "Notes for the buyer",
        placeholder: "Ring the bell at the side entrance.",
        multiline: true,
      },
    ],
  },
};

export const DELIVERY_METHOD_LIST = DELIVERY_METHOD_TYPES.map(
  (t) => DELIVERY_METHOD_DEFS[t],
);

export function isDeliveryMethodType(v: string): v is DeliveryMethodType {
  return (DELIVERY_METHOD_TYPES as readonly string[]).includes(v);
}

/** Collection needs a pickup address to be usable; shipping is fine bare. */
export function isDeliveryConfigured(type: string, config: DeliveryConfig) {
  if (!isDeliveryMethodType(type)) return false;
  if (type === "collection") return Boolean(config.address?.trim());
  return true;
}
