import { describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * Renders every message to an HTML file for visual review. Runs only when
 * EMAIL_PREVIEW_DIR names where to put them, so the ordinary suite skips it.
 */

import type * as TransportModule from "@sailo/mailer/transport";

const DIR = process.env.EMAIL_PREVIEW_DIR;

vi.mock("./transport", async (importOriginal) => {
  const actual = await importOriginal<typeof TransportModule>();
  return {
    ...actual,
    send: vi.fn(async (opts: { subject: string; html: string }) => {
      if (DIR) {
        mkdirSync(DIR, { recursive: true });
        const name = opts.subject.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 60);
        writeFileSync(`${DIR}/${name}.html`, opts.html);
      }
      return { sent: true, id: "preview" };
    }),
  };
});

import type { Order, Shop } from "@sailo/db/schema";
import {
  sendAffiliateWelcome,
  sendBookingDecision,
  sendDownloadReady,
  sendEmailConfirmation,
  sendHqSignInLink,
  sendOrderConfirmation,
  sendPasswordReset,
  sendPortalLinks,
  sendRefundNotification,
  sendShippingNotification,
  sendSupportTicket,
} from "./index-all";

const shop = (over: Partial<Shop> = {}) =>
  ({
    name: "Forno Nove",
    handle: "forno",
    plan: "free",
    subscriptionStatus: null,
    compPlan: null,
    accentColor: "#0e7490",
    logoUrl: "https://picsum.photos/seed/forno/200",
    contactEmail: "ciao@fornonove.it",
    timeZone: "Europe/Rome",
    currency: "EUR",
    ...over,
  }) as Shop;

const order = (over: Partial<Order> = {}) =>
  ({
    id: "6f1d2b7e-0000-0000-0000-000000000000",
    productTitle: "Sourdough workshop",
    variantLabel: null,
    itemCount: 3,
    currency: "EUR",
    subtotalCents: 14100,
    discountCents: 1500,
    couponCode: "SPRING",
    deliveryFeeCents: 500,
    deliveryLabel: "Courier (Milan)",
    taxCents: 2400,
    taxRateBp: 2200,
    taxName: "IVA",
    taxInclusive: false,
    totalCents: 15500,
    refundedCents: 0,
    customerName: "Ana María Ruiz-Peña",
    customerEmail: "ana@example.com",
    addressLine1: "Via Roma 12",
    addressLine2: null,
    city: "Milano",
    region: "MI",
    postalCode: "20121",
    country: "Italy",
    note: "Please ring the bell twice — the courtyard door sticks.",
    paymentMethod: "bank_transfer",
    paymentStatus: "pending",
    paymentReference: "TRX-99821",
    deliveryMethod: "shipping",
    pickupLocation: null,
    scheduledFor: new Date("2026-09-12T08:30:00Z"),
    serviceMode: "in_person",
    serviceLocation: "Forno Nove, Via Roma 12, Milano",
    trackingCarrier: "DHL",
    trackingNumber: "JD014600003RM",
    trackingUrl: "https://www.dhl.com/track?id=JD014600003RM",
    downloadLimit: 3,
    downloadExpiresAt: new Date("2026-11-01T00:00:00Z"),
    refundReason: null,
    ...over,
  }) as Order;

const items = [
  {
    id: "a",
    orderId: "6f1d2b7e",
    position: 0,
    productId: "p1",
    variantId: null,
    title: "Sourdough workshop",
    variantLabel: null,
    sku: null,
    kind: "service",
    imageUrl: "https://picsum.photos/seed/bread/200",
    unitPriceCents: 9000,
    quantity: 1,
    subtotalCents: 9000,
    scheduledFor: new Date("2026-09-12T08:30:00Z"),
    serviceMode: "in_person",
    serviceLocation: "Forno Nove, Via Roma 12, Milano",
  },
  {
    id: "b",
    orderId: "6f1d2b7e",
    position: 1,
    productId: "p2",
    variantId: "v1",
    title: "Speckled mug",
    variantLabel: "Large / Terracotta",
    sku: "MUG-L-T",
    kind: "physical",
    imageUrl: "https://picsum.photos/seed/mug/200",
    unitPriceCents: 1800,
    quantity: 2,
    subtotalCents: 3600,
    scheduledFor: null,
    serviceMode: null,
    serviceLocation: null,
  },
  {
    id: "c",
    orderId: "6f1d2b7e",
    position: 2,
    productId: "p3",
    variantId: null,
    title: "Recipe zine (PDF)",
    variantLabel: null,
    sku: null,
    kind: "digital",
    imageUrl: null,
    unitPriceCents: 1500,
    quantity: 1,
    subtotalCents: 1500,
    scheduledFor: null,
    serviceMode: null,
    serviceLocation: null,
  },
];

describe.skipIf(!DIR)("email previews", () => {
  it("renders every message", async () => {
    const results = await Promise.all([
      sendOrderConfirmation({
        shop: shop(),
        order: order(),
        items,
        invoiceUrl: "http://localhost:3000/invoice/tok",
        invoiceNumber: "INV-0042",
        downloadPending: true,
      }),
      sendDownloadReady({ shop: shop(), order: order(), url: "http://localhost:3000/download/tok" }),
      sendShippingNotification({ shop: shop(), order: order() }),
      sendBookingDecision({ shop: shop(), order: order(), accepted: true }),
      sendBookingDecision({
        shop: shop({ name: "Studio Lume", contactEmail: "hi@lume.co" }),
        order: order(),
        accepted: false,
      }),
      sendRefundNotification({
        shop: shop(),
        order: order({ refundedCents: 3600, refundReason: "One mug arrived chipped — sorry!" }),
      }),
      sendSupportTicket({
        shopName: "Forno Nove",
        handle: "forno",
        email: "owner@fornonove.it",
        topic: "payments",
        subject: "Stripe payout stuck for five days",
        message: "The payout scheduled for Monday still says pending.\n\nAccount is verified and charges are enabled.",
        imageUrls: ["https://picsum.photos/seed/shot/600"],
        ticketId: "TCK-3181",
      }),
      sendAffiliateWelcome({
        to: "ana@example.com",
        shopName: "Forno Nove",
        percent: "12",
        shareUrl: "http://localhost:3000/forno?ref=ana-8823-xyz",
        portalUrl: "http://localhost:3000/partners/report/8f3a9c1d2e",
      }),
      sendPortalLinks({
        to: "ana@example.com",
        links: [
          { shopName: "Forno Nove", url: "http://localhost:3000/partners/report/8f3a" },
          { shopName: "Studio Lume", url: "http://localhost:3000/partners/report/9c1d" },
        ],
      }),
      sendHqSignInLink({ to: "staff@sailo.store", url: "http://localhost:3000/hq/x", expiresInMinutes: 15 }),
      sendEmailConfirmation({ to: "new@seller.com", name: "Ana", url: "http://localhost:3000/confirm/x" }),
      sendPasswordReset({ to: "new@seller.com", name: "Ana", url: "http://localhost:3000/reset/x", expiresInHours: 2 }),
    ]);
    for (const r of results) expect(r.sent).toBe(true);
  });
});
