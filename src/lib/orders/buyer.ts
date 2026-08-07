import type { PaymentMethodDef } from "@/lib/payments";
import { normalizePhone } from "@/lib/utils";
import { clean } from "./sanitize";

/**
 * What the buyer told us, checked against what the payment rail needs.
 *
 * Each rail states its own requirements rather than having them inferred from
 * its kind: a bank transfer settles later and needs a way to reach the buyer,
 * a card settles immediately and needs an address only if the seller ships.
 * Reading the rail's own `requires` is what keeps a new rail from silently
 * inheriting the wrong rule.
 */

export type BuyerAddress = {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
};

export type BuyerDetails = {
  name: string | null;
  email: string | null;
  phone: string | null;
  note: string | null;
  address: BuyerAddress;
};

export type BuyerInput = {
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  note?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
};

const NO_ADDRESS: BuyerAddress = {
  addressLine1: null,
  addressLine2: null,
  city: null,
  region: null,
  postalCode: null,
  country: null,
};

export type BuyerResult =
  | { ok: true; buyer: BuyerDetails }
  | { ok: false; error: string };

export function readBuyer(
  input: BuyerInput,
  opts: {
    /** The chosen rail, which states what it needs. */
    def: Pick<PaymentMethodDef, "requires">;
    /** False for collection orders, which have nowhere to deliver. */
    wantsAddress: boolean;
  },
): BuyerResult {
  const email = clean(input.customerEmail, 160)?.toLowerCase() ?? null;
  const phoneRaw = clean(input.customerPhone, 40);
  const phone = phoneRaw ? normalizePhone(phoneRaw) || null : null;

  if (opts.def.requires.email && !email) {
    return { ok: false, error: "Add your email so we can send your receipt." };
  }
  /*
   * Shaped like an address, not merely present.
   *
   * This is the `to:` on the receipt, the invoice link and — for a digital
   * order — the download link, and Resend takes a JSON body, so a malformed
   * value is not an injection: it is a send that fails quietly. The buyer pays
   * and hears nothing, and the seller sees a completed order with no clue why
   * the customer is emailing them to ask where their file is.
   *
   * A single deliberately loose test. Anything stricter rejects addresses that
   * are valid — quoted locals, new TLDs, unicode domains — and the only real
   * proof an address works is the mail arriving.
   */
  if (email && !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) {
    return { ok: false, error: "That email address doesn't look right." };
  }
  if (opts.def.requires.contact && !email && !phone) {
    return {
      ok: false,
      error: "Add an email or phone number so the seller can reach you.",
    };
  }

  return {
    ok: true,
    buyer: {
      name: clean(input.customerName, 120),
      email,
      phone,
      note: clean(input.note, 500),
      // A collection order stores no address. Keeping whatever was typed
      // would leave a delivery address on an order nobody delivers.
      address: opts.wantsAddress
        ? {
            addressLine1: clean(input.addressLine1, 200),
            addressLine2: clean(input.addressLine2, 200),
            city: clean(input.city, 100),
            region: clean(input.region, 100),
            postalCode: clean(input.postalCode, 32),
            country: clean(input.country, 100),
          }
        : NO_ADDRESS,
    },
  };
}
