/*
 * The order evidence pack. Spec 45.
 *
 * `assembleEvidence` can tell a seller that a `product_not_received` case needs
 * a proof of delivery. It cannot produce one — and until now, neither could
 * Sailo: all nine of `EVIDENCE_FILE_FIELDS` were `needs_seller`, every time,
 * with a `FILE_ASKS` string asking somebody to go and find a document.
 *
 * **Seven of those nine are things Sailo already holds.** The receipt is an
 * invoice we generated and emailed. The refund and cancellation policies are
 * `policy_snapshots` (spec 44). The customer communication is `order_messages`.
 * The service documentation is bookings, tickets, check-ins and the download
 * log. The shipping documentation is tracking plus `delivered_at`. The duplicate
 * documentation is a charge `holdings.ts` already locates. The seller was being
 * asked to hand-produce documents out of our own database, an hour before a
 * deadline, and most will not manage it. That is the whole feature.
 *
 * ─── THIS MODULE IS THE CONTENT, NOT THE RENDERING ──────────────────────────
 *
 * What sections, in what order, from what facts — testable from object literals
 * with no renderer in the room. The positional layout lives beside
 * `invoice-pdf.ts`, where positional layout belongs.
 *
 * ─── THE RULE THAT GOVERNS EVERY LINE ───────────────────────────────────────
 *
 * **Never state a fact Sailo does not hold.** A pack that says "delivered"
 * because a seller ticked a box, or prints today's refund policy against a sale
 * from March, is a false claim to a bank made in Sailo's name on the seller's
 * behalf — it loses the case *and* damages the person who submitted it. So:
 *
 *   - every line carries its provenance and its date;
 *   - `orders.deliveredSource` is printed in words, because `seller`,
 *     `buyer_confirmed` and `carrier` are not equally persuasive and must never
 *     be shown as though they were;
 *   - a missing fact is **"Not on record"**, never a blank. An adjudicator
 *     reading a gap draws the worse conclusion; a stated gap with the rest of
 *     the document intact does not.
 *
 * ─── AND DETERMINISM ────────────────────────────────────────────────────────
 *
 * No clock is read anywhere in here. `renderedAt` is passed in, so the same
 * holdings produce the same document twice — which is what makes "re-render the
 * case exactly" true rather than approximate.
 */

import type { DeliverySource } from "./messages";
import { evidenceDate, evidenceMoney } from "./text";

/**
 * Bumped when the *content* of a pack changes — a section added, a line
 * reworded, a fact newly printed.
 *
 * Recorded into `disputes.evidenceSnapshot` alongside the payload, so a case
 * reviewed a year later can be re-rendered exactly rather than re-rendered
 * plausibly. Not a formatting version: moving a rule two points down the page
 * changes nothing anybody argues about.
 */
export const EVIDENCE_PACK_VERSION = "2026-08";

/** What a pack line says when Sailo holds nothing. Never a blank. */
export const NOT_ON_RECORD = "Not on record";

/* -------------------------------------------------------------------------- */
/*  What a pack is made of                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One fact, with where it came from.
 *
 * `provenance` is not decoration and it is not optional: it is the difference
 * between evidence and assertion. An adjudicator reading "Delivered 12 August"
 * and an adjudicator reading "Delivered 12 August — marked delivered by the
 * seller; no carrier confirmation" are weighing two different claims, and only
 * the second one is true.
 */
export type PackLine = {
  label: string;
  /** The value, or `NOT_ON_RECORD`. */
  value: string;
  /** Where the value came from, in words a non-engineer reads. */
  provenance?: string;
};

export type PackSection = {
  title: string;
  /** One line of prose under the heading, where the section needs framing. */
  note?: string;
  lines: readonly PackLine[];
  /** Rows too long for a label/value pair — a message log, a download log. */
  entries?: readonly string[];
  /** Stated when `entries` was cut short, because a silent cap reads as "all". */
  entriesCapped?: { shown: number; total: number };
};

/**
 * Which Stripe evidence slot a generated document fills.
 *
 * One document per slot rather than one pack for all of them, because the
 * networks read per field: an adjudicator looking for proof of delivery should
 * not have to find page 7 of a general pack.
 */
export type PackDocumentKind =
  | "pack"
  | "receipt"
  | "policy"
  | "communications"
  | "fulfilment";

export type PackDocument = {
  kind: PackDocumentKind;
  /** The evidence field this fills, or null for the human-readable pack. */
  field:
    | "receipt"
    | "refund_policy"
    | "cancellation_policy"
    | "customer_communication"
    | "shipping_documentation"
    | "service_documentation"
    | "uncategorized_file";
  title: string;
  sections: readonly PackSection[];
  /**
   * How readily this document should yield to a seller's own upload.
   *
   * Lowest-value-first-out. A generated fulfilment document is a fair account of
   * what Sailo saw; a carrier's own proof of delivery is what wins the case, so
   * if the 4.5 MB budget is tight the generated one must give way rather than
   * block. Higher numbers evict first.
   */
  priority: number;
};

/* -------------------------------------------------------------------------- */
/*  Holdings                                                                  */
/* -------------------------------------------------------------------------- */

/** What was sold, which decides the fulfilment document more than the reason does. */
export type PackKind = "physical" | "digital" | "service" | "event" | "membership";

export type PackMessage = {
  at: Date;
  kind: string;
  direction: string;
  toAddress: string | null;
  subject: string | null;
  bodyText: string | null;
  /** `sent` | `delivered` | `bounced` | `complained`. */
  status: string | null;
};

export type PackDownload = {
  at: Date;
  ip: string | null;
  fileName: string | null;
};

/**
 * Everything a pack prints, flattened, already read from the database.
 *
 * Nullable throughout for the reason `EvidenceHoldings` is: the interesting case
 * is the order that is missing something, and a shape that required its fields
 * could not represent it.
 */
export type PackHoldings = {
  /* The sale */
  orderReference: string;
  placedAt: Date;
  kind: PackKind;
  currency: string;
  totalCents: number;
  productDescription: string | null;
  /** What the buyer saw on their statement. Snapshotted onto the order. */
  statementDescriptor: string | null;

  /* Who */
  shopName: string;
  customerName: string | null;
  customerEmail: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  buyerIp: string | null;
  buyerUserAgent: string | null;
  /**
   * Last four and brand, from Stripe's charge. **Nothing else, ever.**
   *
   * There is no field on this type for a PAN, an expiry or a CVC, which is the
   * point: a shape that cannot carry card data cannot leak it into a document
   * three people forward by email.
   */
  cardBrand: string | null;
  cardLast4: string | null;

  /* The invoice */
  invoiceNumber: string | null;
  invoiceIssuedAt: Date | null;

  /* What they agreed to */
  termsAcceptedAt: Date | null;
  policyText: string | null;
  policyCapturedAt: Date | null;
  /** `shop_page` | `url_fetch` | `manual` | `platform`. Printed, because it matters. */
  policySource: string | null;
  policySourceUrl: string | null;

  /* Delivery */
  shippingCarrier: string | null;
  shippingTrackingNumber: string | null;
  shippingTrackingUrl: string | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  deliveredSource: DeliverySource | null;
  deliverySignedBy: string | null;

  /* Service and event */
  scheduledFor: Date | null;
  serviceLocation: string | null;
  serviceCompletedAt: Date | null;
  ticketCode: string | null;
  ticketUsedAt: Date | null;
  ticketCheckedInBy: string | null;

  /* Membership */
  membershipStatus: string | null;
  membershipPeriodEnd: Date | null;
  checkIns: readonly Date[];
  renewalInvoices: readonly { number: string; at: Date }[];

  /* Digital */
  downloads: readonly PackDownload[];
  downloadReleasedAt: Date | null;

  /* Conversation */
  messages: readonly PackMessage[];

  /* Money afterwards */
  refundedCents: number;
  refundedAt: Date | null;

  /** Passed in. Nothing here reads a clock — see the module header. */
  renderedAt: Date;
};

/* -------------------------------------------------------------------------- */
/*  Provenance                                                                */
/* -------------------------------------------------------------------------- */

/**
 * How a delivery came to be recorded, in words.
 *
 * `orders.delivered_source` exists precisely for this, and the wording is the
 * load-bearing part. "Marked delivered by the seller" is not "signed for", and a
 * pack that printed the first as the second would be a false claim to a bank
 * made on the seller's behalf.
 */
export const DELIVERY_PROVENANCE: Readonly<Record<DeliverySource, string>> = {
  seller: "Marked delivered by the seller. No carrier confirmation is held.",
  buyer_confirmed:
    "Confirmed by the buyer, from a link in the shipping email, from their own device.",
  carrier: "Confirmed by the carrier's own delivery record.",
};

/** The same, one clause long, for a line's `provenance`. */
export function deliveryProvenance(source: DeliverySource | null): string {
  return source ? DELIVERY_PROVENANCE[source] : "Source not recorded.";
}

/** How a policy snapshot came to be held. Printed beside the text. */
export function policyProvenance(source: string | null, capturedAt: Date | null): string {
  const when = capturedAt ? ` Captured ${date(capturedAt)}.` : "";
  switch (source) {
    case "shop_page":
      /*
       * The strong one, and worth saying why: the text was written by the seller
       * inside Sailo, so it cannot have changed under us between the sale and
       * this document.
       */
      return `Written by the shop and hosted by Sailo, so the text cannot have changed since the sale.${when}`;
    case "url_fetch":
      return `Fetched from the shop's own website and stored at the time.${when}`;
    case "manual":
      return `Supplied by the shop.${when}`;
    case "platform":
      return `Sailo's own published terms.${when}`;
    default:
      return `Source not recorded.${when}`;
  }
}

/* -------------------------------------------------------------------------- */
/*  Formatting                                                                */
/* -------------------------------------------------------------------------- */

/* The shared formatters, with this pack's own absence wording. */
function date(value: Date | null | undefined): string {
  return evidenceDate(value) ?? NOT_ON_RECORD;
}

function stamp(value: Date | null | undefined): string {
  return value ? value.toISOString().replace("T", " ").slice(0, 19) + " UTC" : NOT_ON_RECORD;
}

const money = evidenceMoney;

function line(label: string, value: string | null | undefined, provenance?: string): PackLine {
  return {
    label,
    value: value && value.trim() ? value.trim() : NOT_ON_RECORD,
    ...(provenance ? { provenance } : {}),
  };
}

/**
 * The most lines of a log a pack prints.
 *
 * The same 200 `holdings.ts` already caps the access log at, and for the same
 * reason: a buyer who fetched a file four hundred times made the point by the
 * twentieth line, and the document has to stay inside a 4.5 MB budget shared
 * with everything else on the case. The cap is *stated* where it bites — a
 * silent truncation reads as "this is all of it".
 */
export const PACK_LOG_CAP = 200;

/**
 * The most lines of policy text a pack prints.
 *
 * ─── MEASURED, NOT GUESSED ──────────────────────────────────────────────────
 *
 * The Files API **enforces** a 50-page ceiling on dispute evidence — verified
 * against the live API in test mode on 19 August 2026: *"The file you uploaded
 * was too long. Please upload a file with fewer than 50 pages."* That is a hard
 * 400, not the advice `PAGE_GUIDANCE` used to describe.
 *
 * `POLICY_BODY_MAX` is 200,000 characters and this section prints the body line
 * by line, so a real seller's terms in short lines reached **98 pages** in a
 * measurement — the upload would be refused and the evidence slot would quietly
 * stay empty. 600 lines is roughly fifteen pages of prose, which is more terms
 * than any issuer reads, and the truncation is *stated* rather than silent.
 *
 * The renderer carries its own hard page ceiling as well. This bounds the common
 * case at the source; that bounds every case.
 */
export const PACK_POLICY_LINE_CAP = 600;

/* -------------------------------------------------------------------------- */
/*  The sections                                                              */
/* -------------------------------------------------------------------------- */

/** Who bought what, for how much, and what the buyer saw on their statement. */
export function saleSection(h: PackHoldings): PackSection {
  return {
    title: "The sale",
    lines: [
      line("Order reference", h.orderReference),
      line("Placed", stamp(h.placedAt), "Sailo's own server clock at checkout."),
      line("What was sold", h.productDescription, "From the order's lines, not its header."),
      line("Total charged", money(h.totalCents, h.currency)),
      line(
        "On the buyer's statement",
        h.statementDescriptor,
        "Snapshotted onto the order at checkout, so a later change to the shop's descriptor does not change what this says.",
      ),
      line("Invoice", h.invoiceNumber, h.invoiceIssuedAt ? `Issued ${date(h.invoiceIssuedAt)}.` : undefined),
      ...(h.refundedCents > 0
        ? [
            line(
              "Refunded",
              `${money(h.refundedCents, h.currency)} on ${date(h.refundedAt)}`,
              "Issued before this dispute.",
            ),
          ]
        : []),
    ],
  };
}

/** Who the buyer was, and how they reached the shop. */
export function buyerSection(h: PackHoldings): PackSection {
  return {
    title: "The buyer",
    note: "Recorded at checkout, from the request itself rather than from anything the buyer typed.",
    lines: [
      line("Name given", h.customerName),
      line("Email given", h.customerEmail),
      line("Billing address", h.billingAddress),
      ...(h.kind === "physical" ? [line("Shipping address", h.shippingAddress)] : []),
      line(
        "Address the order came from",
        h.buyerIp,
        "The IP address of the connection that placed the order.",
      ),
      line("Browser", h.buyerUserAgent),
      line(
        "Card",
        h.cardBrand && h.cardLast4 ? `${h.cardBrand} ending ${h.cardLast4}` : null,
        "From Stripe. Sailo never sees or stores a card number.",
      ),
    ],
  };
}

/** What the buyer agreed to, as it stood — never as it stands today. */
export function policySection(h: PackHoldings): PackSection {
  return {
    title: "The terms the buyer accepted",
    note: h.termsAcceptedAt
      ? "Acceptance is recorded server-side at checkout, from Sailo's own clock, not from a flag the browser sent."
      : "This shop did not require terms acceptance on this order.",
    lines: [
      line("Accepted at", h.termsAcceptedAt ? stamp(h.termsAcceptedAt) : null),
      line(
        "Policy text held",
        h.policyText ? "Yes — reproduced below" : null,
        h.policyText ? policyProvenance(h.policySource, h.policyCapturedAt) : undefined,
      ),
      ...(h.policySourceUrl ? [line("Published at", h.policySourceUrl)] : []),
    ],
    entries: policyLines(h.policyText).lines,
    ...(policyLines(h.policyText).capped
      ? {
          entriesCapped: {
            shown: PACK_POLICY_LINE_CAP,
            total: policyLines(h.policyText).total,
          },
        }
      : {}),
  };
}

/** The policy body, bounded — see `PACK_POLICY_LINE_CAP`. */
function policyLines(text: string | null): {
  lines: string[] | undefined;
  capped: boolean;
  total: number;
} {
  if (!text) return { lines: undefined, capped: false, total: 0 };
  const all = text.split("\n");
  return {
    lines: all.slice(0, PACK_POLICY_LINE_CAP),
    capped: all.length > PACK_POLICY_LINE_CAP,
    total: all.length,
  };
}

/**
 * Every message sent about this order, as sent.
 *
 * `order_messages` writes a row only where the send actually succeeded, so this
 * section is a list of things that happened rather than things that were
 * attempted. A bounced message is *included and labelled*: it explains why a
 * buyer says they never heard anything, and disclosing it is honest in a way
 * that omitting it is not.
 */
export function communicationsSection(h: PackHoldings): PackSection {
  const shown = h.messages.slice(0, PACK_LOG_CAP);

  return {
    title: "Messages sent to the buyer",
    note:
      "Recorded at the moment each message was accepted for delivery. A message that failed to send is not listed; " +
      "one that bounced is listed and marked as bounced.",
    lines:
      h.messages.length === 0
        ? [line("Messages on record", null, "No message was recorded against this order.")]
        : [line("Messages on record", String(h.messages.length))],
    entries: shown.map(
      (message) =>
        `${stamp(message.at)} — ${message.direction} — ${message.kind}` +
        (message.toAddress ? ` to ${message.toAddress}` : "") +
        (message.subject ? ` — "${message.subject}"` : "") +
        (message.status ? ` — ${message.status}` : ""),
    ),
    ...(h.messages.length > shown.length
      ? { entriesCapped: { shown: shown.length, total: h.messages.length } }
      : {}),
  };
}

/**
 * How the thing sold reached the buyer, per kind.
 *
 * This is where the pack earns its keep, because each kind is won differently —
 * and it is where the provenance rule bites hardest, because "delivered" is the
 * word a seller most wants printed and the one Sailo most often cannot support.
 */
export function fulfilmentSection(h: PackHoldings): PackSection {
  switch (h.kind) {
    case "physical":
      return {
        title: "Delivery",
        lines: [
          line("Carrier", h.shippingCarrier),
          line("Tracking number", h.shippingTrackingNumber),
          line("Tracking page", h.shippingTrackingUrl),
          line("Shipped", date(h.shippedAt), "Recorded when the shop marked it shipped."),
          line(
            "Delivered",
            h.deliveredAt ? stamp(h.deliveredAt) : null,
            deliveryProvenance(h.deliveredSource),
          ),
          line("Signed for by", h.deliverySignedBy),
          line("Sent to", h.shippingAddress, "The address the buyer gave at checkout."),
        ],
      };

    case "digital": {
      const shown = h.downloads.slice(0, PACK_LOG_CAP);
      return {
        title: "Downloads",
        note:
          "One line per time the buyer fetched a file, with the address they fetched it from. " +
          "The address the order was placed from is printed beside it so the match can be read rather than inferred.",
        lines: [
          line("Files released", h.downloadReleasedAt ? stamp(h.downloadReleasedAt) : null),
          line("Times fetched", String(h.downloads.length)),
          line(
            "Address the order came from",
            h.buyerIp,
            "For comparison with the addresses below.",
          ),
        ],
        entries: shown.map(
          (download) =>
            `${stamp(download.at)} — ${download.ip ?? "address not recorded"} — ${
              download.fileName ?? "file"
            }`,
        ),
        ...(h.downloads.length > shown.length
          ? { entriesCapped: { shown: shown.length, total: h.downloads.length } }
          : {}),
      };
    }

    case "service":
      return {
        title: "The appointment",
        lines: [
          line("Booked for", h.scheduledFor ? stamp(h.scheduledFor) : null),
          line("Where", h.serviceLocation),
          line(
            "Marked completed",
            h.serviceCompletedAt ? stamp(h.serviceCompletedAt) : null,
            "Recorded by the shop. Sailo does not observe the appointment itself.",
          ),
        ],
      };

    case "event":
      return {
        title: "Attendance",
        note:
          "A scanned ticket is attendance, and it is the strongest answer a not-received claim can meet.",
        lines: [
          line("Ticket code", h.ticketCode),
          line(
            "Scanned at the door",
            h.ticketUsedAt ? stamp(h.ticketUsedAt) : null,
            h.ticketUsedAt
              ? "Recorded by Sailo's own scanner at the moment of admission."
              : "This ticket was never scanned.",
          ),
          line("Scanned by", h.ticketCheckedInBy),
        ],
      };

    case "membership":
      return {
        title: "Membership use",
        note:
          "For a cancellation claim, use after the date the cardholder says they cancelled is the argument.",
        lines: [
          line("Status", h.membershipStatus),
          line("Paid up to", h.membershipPeriodEnd ? date(h.membershipPeriodEnd) : null),
          line("Times admitted", String(h.checkIns.length)),
          line("Renewal invoices", String(h.renewalInvoices.length)),
        ],
        entries: [
          ...h.checkIns.slice(0, PACK_LOG_CAP).map((at) => `${stamp(at)} — admitted`),
          ...h.renewalInvoices
            .slice(0, PACK_LOG_CAP)
            .map((invoice) => `${date(invoice.at)} — invoice ${invoice.number}`),
        ],
      };
  }
}

/* -------------------------------------------------------------------------- */
/*  The documents                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Which evidence slot the fulfilment document fills, per kind.
 *
 * A parcel's is `shipping_documentation`; everything else is
 * `service_documentation`. Putting a download log in the shipping slot would
 * hand an adjudicator looking for a carrier's scan a list of IP addresses, which
 * reads as an evasion rather than as evidence.
 */
export function fulfilmentField(
  kind: PackKind,
): "shipping_documentation" | "service_documentation" {
  return kind === "physical" ? "shipping_documentation" : "service_documentation";
}

/**
 * Every document Sailo can produce for this order.
 *
 * A document is only offered when it has something in it: a pack with an empty
 * Communications section is a page that says "we have nothing", registered
 * against an evidence slot that would otherwise have shown as needing the
 * seller's own upload — which is worse, because the seller then believes it is
 * handled.
 */
export function packDocuments(h: PackHoldings): PackDocument[] {
  const documents: PackDocument[] = [];

  /*
   * The human-readable pack, always. It fills `uncategorized_file`, and it is
   * the one a seller downloads, keeps, or emails — which is why it exists even
   * on an order with almost nothing on it.
   */
  documents.push({
    kind: "pack",
    field: "uncategorized_file",
    title: `Evidence pack — order ${h.orderReference}`,
    sections: [
      saleSection(h),
      buyerSection(h),
      policySection(h),
      fulfilmentSection(h),
      communicationsSection(h),
    ],
    /*
     * Evicted first. It is a summary of documents that are also attached
     * individually, so if the budget is tight it is the one whose absence costs
     * least — and `uncategorized_file` is the slot an issuer reads last.
     */
    priority: 100,
  });

  if (h.invoiceNumber) {
    documents.push({
      kind: "receipt",
      field: "receipt",
      title: `Receipt — ${h.invoiceNumber}`,
      sections: [saleSection(h), buyerSection(h)],
      priority: 40,
    });
  }

  if (h.policyText) {
    documents.push({
      kind: "policy",
      field: "refund_policy",
      title: "Refund policy, as the buyer saw it",
      sections: [policySection(h)],
      priority: 30,
    });
  }

  if (h.messages.length > 0) {
    documents.push({
      kind: "communications",
      field: "customer_communication",
      title: "Messages sent to the buyer",
      sections: [communicationsSection(h)],
      priority: 20,
    });
  }

  if (hasFulfilmentEvidence(h)) {
    documents.push({
      kind: "fulfilment",
      field: fulfilmentField(h.kind),
      title: fulfilmentSection(h).title,
      sections: [fulfilmentSection(h)],
      /*
       * The lowest priority, so it is the **last** thing evicted and the first
       * thing a seller's own upload displaces — which is the same statement from
       * two directions. A carrier's proof of delivery beats our account of what
       * we saw; ours beats nothing at all.
       */
      priority: 10,
    });
  }

  return documents;
}

/** Whether there is anything to say about fulfilment beyond "nothing happened". */
export function hasFulfilmentEvidence(h: PackHoldings): boolean {
  switch (h.kind) {
    case "physical":
      return Boolean(h.shippedAt || h.deliveredAt || h.shippingTrackingNumber);
    case "digital":
      return h.downloads.length > 0;
    case "service":
      return Boolean(h.scheduledFor || h.serviceCompletedAt);
    case "event":
      return Boolean(h.ticketUsedAt || h.ticketCode);
    case "membership":
      return h.checkIns.length > 0 || h.renewalInvoices.length > 0;
  }
}

/* -------------------------------------------------------------------------- */
/*  Size                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Roughly how many bytes a document will come to, before rendering it.
 *
 * An estimate on purpose. The 4.5 MB budget is combined across every file on the
 * dispute, and the useful moment is *before* generating five documents and
 * discovering the set is over — so this is used to decide what to offer, and the
 * real byte count from the renderer is what is stored.
 *
 * The constant is deliberately generous. Under-estimating produces a set that is
 * rejected at submission with hours left on the clock; over-estimating produces
 * one document fewer, which is recoverable.
 */
export function estimateBytes(document: PackDocument): number {
  const text = document.sections.reduce(
    (sum, section) =>
      sum +
      section.title.length +
      (section.note?.length ?? 0) +
      section.lines.reduce(
        (n, entry) => n + entry.label.length + entry.value.length + (entry.provenance?.length ?? 0),
        0,
      ) +
      (section.entries?.reduce((n, entry) => n + entry.length, 0) ?? 0),
    0,
  );

  /*
   * A PDF's own overhead — the catalogue, the page tree, the font descriptor —
   * plus roughly three bytes of file per byte of text once layout and encoding
   * are paid for.
   */
  return 6_000 + text * 3;
}

/**
 * Which documents fit, lowest-value-first-out.
 *
 * `held` is what the dispute already carries, which on a live case is whatever
 * the seller has uploaded. Their documents are never evicted — a seller's real
 * carrier proof of delivery beats anything generated, and a generator that could
 * push one out would be the worst possible bug in this feature.
 */
export function fitDocuments(
  documents: readonly PackDocument[],
  heldBytes: number,
  budgetBytes: number,
): { include: PackDocument[]; dropped: PackDocument[] } {
  /*
   * `sort` on a copy rather than `toSorted`: this package compiles against the
   * Hermes standard library, which the phone runs and which does not have it.
   */
  const ordered = [...documents].sort((a, b) => a.priority - b.priority);
  const include: PackDocument[] = [];
  const dropped: PackDocument[] = [];
  let spent = heldBytes;

  for (const document of ordered) {
    const size = estimateBytes(document);
    if (spent + size > budgetBytes) {
      dropped.push(document);
      continue;
    }
    include.push(document);
    spent += size;
  }

  return { include, dropped };
}
