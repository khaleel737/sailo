import "server-only";
import PDFDocument from "pdfkit";
import type { Invoice, Order, Shop } from "@/db/schema";
import type { OrderLine } from "@/lib/order-lines";
import { PAYMENT_METHOD_DEFS, isPaymentMethodType } from "@/lib/payments";
import { formatPercent } from "@/lib/pricing";
import { formatAddress, formatMoney } from "@/lib/utils";

const INK = "#1a1a20";
const MUTED = "#6d6d7d";
const LINE = "#e6e6ea";
const MARGIN = 50;

/**
 * Renders the invoice with pdfkit's built-in Helvetica, so no font files need
 * bundling and it works unchanged on serverless.
 */
/** "VAT (20%)" — the rate is snapshotted on the order, not read from the shop. */
function taxLabel(order: { taxName: string | null; taxRateBp: number }) {
  const name = order.taxName ?? "Tax";
  return order.taxRateBp > 0
    ? `${name} (${formatPercent(order.taxRateBp)}%)`
    : name;
}

export function renderInvoicePdf(data: {
  shop: Shop;
  order: Order;
  invoice: Invoice;
  /** Every line of the order, in the seller's order. */
  items: OrderLine[];
}): Promise<Buffer> {
  const { shop, order, invoice, items } = data;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN });
    const chunks: Buffer[] = [];

    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const right = doc.page.width - MARGIN;
    const width = right - MARGIN;
    const money = (cents: number) => formatMoney(cents, order.currency);

    /* ---- header ------------------------------------------------------- */

    doc.fillColor(INK).font("Helvetica-Bold").fontSize(18).text(shop.name, MARGIN, MARGIN);

    let y = doc.y + 2;
    doc.font("Helvetica").fontSize(9).fillColor(MUTED);
    for (const line of [shop.location, shop.contactEmail, shop.taxId ? `Tax ID: ${shop.taxId}` : null]) {
      if (!line) continue;
      doc.text(line, MARGIN, y, { width: width * 0.5 });
      y = doc.y;
    }

    // Invoice block, right aligned.
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(MUTED)
      .text("INVOICE", MARGIN, MARGIN, { width, align: "right" });
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .fillColor(INK)
      .text(invoice.number, MARGIN, doc.y, { width, align: "right" });
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(MUTED)
      .text(
        invoice.issuedAt.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
        MARGIN,
        doc.y,
        { width, align: "right" },
      );

    const statusLabel =
      order.paymentStatus === "paid"
        ? "PAID"
        : order.paymentStatus === "refunded"
          ? "REFUNDED"
          : order.paymentStatus === "pending"
            ? "PAYMENT SENT"
            : "UNPAID";
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(order.paymentStatus === "paid" ? "#0d7d63" : MUTED)
      .text(statusLabel, MARGIN, doc.y + 2, { width, align: "right" });

    y = Math.max(y, doc.y) + 18;
    doc.moveTo(MARGIN, y).lineTo(right, y).strokeColor(LINE).lineWidth(1).stroke();
    y += 18;

    /* ---- parties ------------------------------------------------------ */

    const colWidth = width / 2 - 10;
    const label = (text: string, x: number, yy: number) =>
      doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(text, x, yy, {
        width: colWidth,
        characterSpacing: 0.5,
      });

    label("BILLED TO", MARGIN, y);
    let leftY = doc.y + 2;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK);
    doc.text(order.customerName ?? "Customer", MARGIN, leftY, { width: colWidth });
    leftY = doc.y;

    doc.font("Helvetica").fontSize(9).fillColor(MUTED);
    for (const line of [
      order.customerEmail,
      order.customerPhone,
      formatAddress(order) || null,
    ]) {
      if (!line) continue;
      doc.text(line, MARGIN, leftY, { width: colWidth });
      leftY = doc.y;
    }

    const rightX = MARGIN + colWidth + 20;
    label("DETAILS", rightX, y);
    let rightY = doc.y + 2;
    doc.font("Helvetica").fontSize(9).fillColor(MUTED);

    const methodName = isPaymentMethodType(order.paymentMethod)
      ? PAYMENT_METHOD_DEFS[order.paymentMethod].name
      : order.paymentMethod;

    for (const line of [
      `Payment: ${methodName}`,
      order.deliveryLabel ? `Delivery: ${order.deliveryLabel}` : null,
      order.pickupLocation ? `Pickup: ${order.pickupLocation}` : null,
      order.scheduledFor
        ? `Booked: ${order.scheduledFor.toLocaleString("en-US", {
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
          })}`
        : null,
      order.trackingNumber
        ? `Tracking: ${[order.trackingCarrier, order.trackingNumber].filter(Boolean).join(" ")}`
        : null,
      order.paymentReference ? `Ref: ${order.paymentReference}` : null,
    ]) {
      if (!line) continue;
      doc.text(line, rightX, rightY, { width: colWidth });
      rightY = doc.y;
    }

    y = Math.max(leftY, rightY) + 22;

    /* ---- line items --------------------------------------------------- */

    const cols = { item: MARGIN, qty: right - 210, price: right - 140, amount: right - 70 };

    doc.font("Helvetica").fontSize(8).fillColor(MUTED);
    doc.text("ITEM", cols.item, y);
    doc.text("QTY", cols.qty, y, { width: 50, align: "right" });
    doc.text("PRICE", cols.price, y, { width: 60, align: "right" });
    doc.text("AMOUNT", cols.amount, y, { width: 70, align: "right" });

    y = doc.y + 6;
    doc.moveTo(MARGIN, y).lineTo(right, y).strokeColor(LINE).stroke();
    y += 10;

    for (const item of items) {
      // A long basket runs onto a second page rather than off the first.
      if (y > doc.page.height - 220) {
        doc.addPage();
        y = MARGIN;
      }

      doc.font("Helvetica-Bold").fontSize(10).fillColor(INK);
      doc.text(item.title, cols.item, y, { width: cols.qty - MARGIN - 10 });

      const detail = [
        [item.variantLabel, item.sku].filter(Boolean).join(" · "),
        item.scheduledFor
          ? item.scheduledFor.toLocaleString("en-US", {
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
            })
          : "",
      ]
        .filter(Boolean)
        .join(" — ");

      if (detail) {
        doc
          .font("Helvetica")
          .fontSize(9)
          .fillColor(MUTED)
          .text(detail, cols.item, doc.y + 1, {
            width: cols.qty - MARGIN - 10,
          });
      }
      const itemBottom = doc.y;

      doc.font("Helvetica").fontSize(10).fillColor(INK);
      doc.text(String(item.quantity), cols.qty, y, { width: 50, align: "right" });
      doc.text(money(item.unitPriceCents), cols.price, y, {
        width: 60,
        align: "right",
      });
      doc.text(money(item.subtotalCents), cols.amount, y, {
        width: 70,
        align: "right",
      });

      y = Math.max(itemBottom, doc.y) + 8;
    }

    y += 6;
    doc.moveTo(MARGIN, y).lineTo(right, y).strokeColor(LINE).stroke();
    y += 12;

    /* ---- totals ------------------------------------------------------- */

    const totalRow = (text: string, value: string, bold = false, colour = INK) => {
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(bold ? 12 : 10)
        .fillColor(bold ? INK : MUTED)
        .text(text, cols.price - 90, y, { width: 150, align: "right" });
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fillColor(colour)
        .text(value, cols.amount, y, { width: 70, align: "right" });
      y = doc.y + 4;
    };

    totalRow("Subtotal", money(order.subtotalCents));
    if (order.discountCents > 0) {
      totalRow(
        order.couponCode ? `Discount (${order.couponCode})` : "Discount",
        `-${money(order.discountCents)}`,
        false,
        "#0d7d63",
      );
    }
    if (order.deliveryFeeCents > 0) {
      totalRow(order.deliveryLabel ?? "Delivery", money(order.deliveryFeeCents));
    }
    // Exclusive tax is a line that adds to the total; inclusive tax is already
    // inside it and is stated underneath instead, as a VAT invoice must.
    if (order.taxCents > 0 && !order.taxInclusive) {
      totalRow(taxLabel(order), money(order.taxCents));
    }

    y += 4;
    doc.moveTo(cols.price - 90, y).lineTo(right, y).strokeColor(LINE).stroke();
    y += 8;
    totalRow("Total", money(order.totalCents), true);
    if (order.taxCents > 0 && order.taxInclusive) {
      totalRow(`Includes ${taxLabel(order)}`, money(order.taxCents));
    }

    if (order.refundedCents > 0) {
      totalRow("Refunded", `-${money(order.refundedCents)}`, false, "#dc2626");
    }

    /* ---- notes -------------------------------------------------------- */

    y += 16;
    if (order.note) {
      doc.font("Helvetica").fontSize(9).fillColor(MUTED);
      doc.text(`Note: ${order.note}`, MARGIN, y, { width });
      y = doc.y + 8;
    }
    if (shop.invoiceNotes) {
      doc.font("Helvetica").fontSize(8).fillColor(MUTED);
      doc.text(shop.invoiceNotes, MARGIN, y, { width });
    }

    /* ---- footer ------------------------------------------------------- */

    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#b8b8c2")
      .text(
        `${shop.name} · ${invoice.number}`,
        MARGIN,
        doc.page.height - MARGIN - 10,
        { width, align: "center" },
      );

    doc.end();
  });
}
