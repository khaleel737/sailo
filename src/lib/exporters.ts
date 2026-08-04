import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, productImages, products } from "@/db/schema";
import { getShopClients, getInvoiceMap } from "@/lib/queries";
import { bool, date, money, toCsv } from "@/lib/csv";
import { PAYMENT_METHOD_DEFS, isPaymentMethodType } from "@/lib/payments";
import { formatPercent } from "@/lib/pricing";

export const EXPORT_TYPES = ["products", "orders", "clients"] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];

export function isExportType(value: string): value is ExportType {
  return (EXPORT_TYPES as readonly string[]).includes(value);
}

/**
 * Column names mirror Shopify's where an equivalent exists, so a file exported
 * here can be fed to their importer and vice versa.
 */
export const PRODUCT_HEADERS = [
  "Handle",
  "Title",
  "Body (HTML)",
  "Type",
  "Category",
  "Tags",
  "Variant Price",
  "Variant Compare At Price",
  "In Stock",
  "Featured",
  "Published",
  "Image Src",
  "Created At",
];

export async function exportProducts(shopId: string) {
  const rows = await getDb().query.products.findMany({
    where: eq(products.shopId, shopId),
    orderBy: [asc(products.position), desc(products.createdAt)],
    with: {
      images: { orderBy: [asc(productImages.position)] },
      category: true,
    },
  });

  return toCsv(
    PRODUCT_HEADERS,
    rows.map((p) => [
      p.slug,
      p.title,
      p.description ?? "",
      p.kind,
      p.category?.name ?? "",
      p.tags.join(", "),
      money(p.priceCents),
      money(p.compareAtCents),
      bool(p.inStock),
      bool(p.isFeatured),
      bool(p.isPublished),
      // Multiple images separated by a pipe, since commas are the delimiter.
      p.images.map((i) => i.url).join(" | "),
      date(p.createdAt),
    ]),
  );
}

export const ORDER_HEADERS = [
  "Order Date",
  "Invoice",
  "Product",
  "Quantity",
  "Currency",
  "Subtotal",
  "Discount",
  "Discount Code",
  "Delivery",
  "Delivery Fee",
  "Tax",
  "Tax Name",
  "Tax Rate",
  "Tax Included In Price",
  "Total",
  "Refunded",
  "Commission",
  "Affiliate",
  "Customer Name",
  "Email",
  "Phone",
  "Address1",
  "Address2",
  "City",
  "Province",
  "Zip",
  "Country",
  "Payment Method",
  "Payment Status",
  "Status",
  "Tracking Carrier",
  "Tracking Number",
  "Shipped At",
  "Note",
];

export async function exportOrders(shopId: string) {
  const rows = await getDb().query.orders.findMany({
    where: eq(orders.shopId, shopId),
    orderBy: [desc(orders.createdAt)],
  });
  const invoices = await getInvoiceMap(rows.map((o) => o.id));

  return toCsv(
    ORDER_HEADERS,
    rows.map((o) => [
      date(o.createdAt),
      invoices.get(o.id)?.number ?? "",
      o.productTitle,
      o.quantity,
      o.currency,
      money(o.subtotalCents),
      money(o.discountCents),
      o.couponCode ?? "",
      o.deliveryLabel ?? "",
      money(o.deliveryFeeCents),
      money(o.taxCents),
      o.taxName ?? "",
      o.taxRateBp > 0 ? `${formatPercent(o.taxRateBp)}%` : "",
      o.taxCents > 0 ? (o.taxInclusive ? "yes" : "no") : "",
      money(o.totalCents),
      money(o.refundedCents),
      money(o.commissionCents),
      o.affiliateCode ?? "",
      o.customerName ?? "",
      o.customerEmail ?? "",
      o.customerPhone ?? "",
      o.addressLine1 ?? "",
      o.addressLine2 ?? "",
      o.city ?? "",
      o.region ?? "",
      o.postalCode ?? "",
      o.country ?? "",
      isPaymentMethodType(o.paymentMethod)
        ? PAYMENT_METHOD_DEFS[o.paymentMethod].name
        : o.paymentMethod,
      o.paymentStatus,
      o.status,
      o.trackingCarrier ?? "",
      o.trackingNumber ?? "",
      date(o.shippedAt),
      o.note ?? "",
    ]),
  );
}

export const CLIENT_HEADERS = [
  "First Name",
  "Last Name",
  "Email",
  "Phone",
  "Address1",
  "Address2",
  "City",
  "Province",
  "Zip",
  "Country",
  "Total Orders",
  "Total Spent",
  "Note",
  "Created At",
];

export async function exportClients(shopId: string) {
  const rows = await getShopClients(shopId);

  return toCsv(
    CLIENT_HEADERS,
    rows.map((c) => {
      // Shopify splits the name; we store one field, so split on first space.
      const [first, ...rest] = c.name.trim().split(/\s+/);
      return [
        first ?? "",
        rest.join(" "),
        c.email ?? "",
        c.phone ?? "",
        c.addressLine1 ?? "",
        c.addressLine2 ?? "",
        c.city ?? "",
        c.region ?? "",
        c.postalCode ?? "",
        c.country ?? "",
        c.orderCount,
        money(c.totalCents),
        c.notes ?? "",
        date(c.createdAt),
      ];
    }),
  );
}

export async function runExport(type: ExportType, shopId: string) {
  switch (type) {
    case "products":
      return { filename: "sailo-products.csv", body: await exportProducts(shopId) };
    case "orders":
      return { filename: "sailo-orders.csv", body: await exportOrders(shopId) };
    case "clients":
      return { filename: "sailo-customers.csv", body: await exportClients(shopId) };
  }
}
