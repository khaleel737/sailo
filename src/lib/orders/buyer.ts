import type { PaymentMethodDef } from "@/lib/payments";
import { normalizeCountry } from "@/lib/countries";
import { normalizePhone } from "@/lib/utils";
import { clean } from "./sanitize";

/**
 * What the buyer told us, checked against what the order cannot be fulfilled
 * without.
 *
 * There is a floor under every order, and then the rail and the goods each add
 * to it. The floor is a name and one way to reach the buyer, and it took a
 * while to get here: the contact rails ask for `requires: {}`, on the reasoning
 * that WhatsApp identifies the buyer by itself. It does — but the order row is
 * written *before* the handoff, and a buyer who never presses send leaves the
 * seller an order from nobody, for an address nowhere, that no one can chase.
 * So an anonymous order is not a lighter checkout; it is an order the seller
 * cannot act on.
 *
 * Above the floor the rules stay derived rather than configurable, because
 * none of them is a matter of taste: a card receipt needs an inbox, a download
 * link needs one to be sent to twice, and something being posted needs
 * somewhere to post it. A seller switch here would only offer the choice of
 * taking orders that cannot be filled.
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
    /** The chosen rail, which states what it needs on top of the floor. */
    def: Pick<PaymentMethodDef, "requires">;
    /** False for collection orders, which have nowhere to deliver. */
    wantsAddress: boolean;
    /**
     * True when the order carries something that arrives by email — a
     * download link, a ticket. The confirmation screen shows both, and a
     * closed tab is all it takes to lose them.
     */
    sendsByEmail?: boolean;
  },
): BuyerResult {
  const name = clean(input.customerName, 120);
  const email = clean(input.customerEmail, 160)?.toLowerCase() ?? null;
  const phoneRaw = clean(input.customerPhone, 40);
  const phone = phoneRaw ? normalizePhone(phoneRaw) || null : null;

  // Whose order this is. Without it the order list, the seller's notification
  // and the packing slip all name nobody.
  if (!name) {
    return { ok: false, error: "Add your name so the seller knows who to expect." };
  }

  if ((opts.def.requires.email || opts.sendsByEmail) && !email) {
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
  /*
   * One way to reach them, on every rail — not only the ones that settle
   * later. This replaced the rails' own `contact` flag, which is gone: a rule
   * that holds for every rail is not something a rail should be asked about.
   */
  if (!email && !phone) {
    return {
      ok: false,
      error: "Add an email or phone number so the seller can reach you.",
    };
  }

  /*
   * Somewhere to send it, when something is being sent.
   *
   * The panel has always asked for an address on a delivery order and nothing
   * has ever checked the answer, so a shipping order could be placed with the
   * fields left blank — the seller finding out only when they came to post it.
   * The street and the town are the floor; the region, the postcode and the
   * country are left alone because plenty of addresses genuinely have none of
   * them, and a required field an honest buyer cannot fill is worse than a
   * blank one.
   */
  if (opts.wantsAddress) {
    const street = clean(input.addressLine1, 200);
    const city = clean(input.city, 100);
    if (!street || !city) {
      return {
        ok: false,
        error: "Add the street and town this should be delivered to.",
      };
    }
  }

  return {
    ok: true,
    buyer: {
      name,
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
            /*
             * The code when it is one, and otherwise whatever was typed.
             *
             * The checkout sends an alpha-2 from a real list now, so new
             * orders store `HR` — which is what a shipping zone, a CSV filter
             * and a broadcast segment can all be asked about. What arrives
             * from an older cached page is still a person's honest answer, so
             * it is kept as written rather than guessed at: turning
             * "Hrvatska" into a code we inferred would be writing down a
             * conclusion as though it were a fact, and `formatAddress` reads
             * both shapes anyway.
             */
            country: normalizeCountry(input.country) ?? clean(input.country, 100),
          }
        : NO_ADDRESS,
    },
  };
}
