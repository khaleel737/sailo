import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { orders, productImages, products, productVariants } from "@/db/schema";
import { getShopClients, getInvoiceMap, getOrderItemsMap } from "@/lib/queries";
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
  "Option1 Name",
  "Option1 Value",
  "Option2 Name",
  "Option2 Value",
  "Option3 Name",
  "Option3 Value",
  "Variant SKU",
  "Variant Price",
  "Variant Compare At Price",
  "Variant Inventory Qty",
  "In Stock",
  "Featured",
  "Published",
  "Image Src",
  "Created At",
];

/**
 * One row per variant, as Shopify writes it: the product's own details appear
 * on its first row and later rows carry only what differs. A product without
 * options is a single row with the option columns blank.
 */
export async function exportProducts(shopId: string, currency: string) {
  const rows = await getDb().query.products.findMany({
    where: eq(products.shopId, shopId),
    orderBy: [asc(products.position), desc(products.createdAt)],
    with: {
      images: { orderBy: [asc(productImages.position)] },
      category: true,
      variants: { orderBy: [asc(productVariants.position)] },
    },
  });

  const lines: (string | number)[][] = [];

  for (const p of rows) {
    // Option columns are positional, so an absent second option is two blanks.
    const optionCells = (values: string[]) =>
      [0, 1, 2].flatMap((i) => [
        p.options[i]?.name ?? "",
        p.options[i] ? (values[i] ?? "") : "",
      ]);

    const productCells = (first: boolean) => [
      p.slug,
      first ? p.title : "",
      first ? (p.description ?? "") : "",
      first ? p.kind : "",
      first ? (p.category?.name ?? "") : "",
      first ? p.tags.join(", ") : "",
    ];

    // "In stock" is the variant's own answer once there are variants — the
    // product-level switch only decides whether any of them are on sale.
    const tailCells = (first: boolean, available = true) => [
      bool(p.inStock && available),
      first ? bool(p.isFeatured) : "",
      first ? bool(p.isPublished) : "",
      // Multiple images separated by a pipe, since commas are the delimiter.
      first ? p.images.map((i) => i.url).join(" | ") : "",
      first ? date(p.createdAt) : "",
    ];

    if (p.variants.length === 0) {
      lines.push([
        ...productCells(true),
        ...optionCells([]),
        "",
        money(p.priceCents, currency),
        money(p.compareAtCents, currency),
        p.trackInventory && p.stockQuantity !== null ? p.stockQuantity : "",
        ...tailCells(true),
      ]);
      continue;
    }

    for (const [index, v] of p.variants.entries()) {
      const first = index === 0;
      lines.push([
        ...productCells(first),
        ...optionCells(p.options.map((o) => v.options[o.name] ?? "")),
        v.sku ?? "",
        money(v.priceCents ?? p.priceCents, currency),
        money(
          v.compareAtCents ?? (v.priceCents === null ? p.compareAtCents : null),
          currency,
        ),
        p.trackInventory && v.stockQuantity !== null ? v.stockQuantity : "",
        ...tailCells(first, v.isAvailable),
      ]);
    }
  }

  return toCsv(PRODUCT_HEADERS, lines);
}

export const ORDER_HEADERS = [
  "Order Date",
  "Invoice",
  "Product",
  "Variant",
  "Variant SKU",
  "Product Type",
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
  "Booked For",
  "Downloads",
  "Note",
];

/**
 * One row per line of the order, the way Shopify writes it: an order with
 * three products is three rows sharing a date and an invoice number, and the
 * order-level money appears on the first of them so a sum over the column
 * still gives the shop's revenue.
 */
export async function exportOrders(shopId: string) {
  const rows = await getDb().query.orders.findMany({
    where: eq(orders.shopId, shopId),
    orderBy: [desc(orders.createdAt)],
  });
  const [invoices, itemsByOrder] = await Promise.all([
    getInvoiceMap(rows.map((o) => o.id)),
    getOrderItemsMap(rows),
  ]);

  const lines = rows.flatMap((o) =>
    (itemsByOrder.get(o.id) ?? []).map((item, index) => ({
      o,
      item,
      first: index === 0,
    })),
  );

  return toCsv(
    ORDER_HEADERS,
    lines.map(({ o, item, first }) => [
      date(o.createdAt),
      invoices.get(o.id)?.number ?? "",
      item.title,
      item.variantLabel ?? "",
      item.sku ?? "",
      item.kind,
      item.quantity,
      o.currency,
      // Order-level money on the first row only, so summing a column across
      // a multi-line order doesn't count its total once per product.
      first ? money(o.subtotalCents, o.currency) : money(item.subtotalCents, o.currency),
      first ? money(o.discountCents, o.currency) : "",
      first ? (o.couponCode ?? "") : "",
      first ? (o.deliveryLabel ?? "") : "",
      first ? money(o.deliveryFeeCents, o.currency) : "",
      first ? money(o.taxCents, o.currency) : "",
      first ? (o.taxName ?? "") : "",
      first && o.taxRateBp > 0 ? `${formatPercent(o.taxRateBp)}%` : "",
      first && o.taxCents > 0 ? (o.taxInclusive ? "yes" : "no") : "",
      first ? money(o.totalCents, o.currency) : "",
      first ? money(o.refundedCents, o.currency) : "",
      first ? money(o.commissionCents, o.currency) : "",
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
      date(item.scheduledFor),
      o.downloadToken
        ? `${o.downloadCount}${o.downloadLimit ? `/${o.downloadLimit}` : ""}`
        : "",
      first ? (o.note ?? "") : "",
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

export async function exportClients(shopId: string, currency: string) {
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
        money(c.totalCents, currency),
        c.notes ?? "",
        date(c.createdAt),
      ];
    }),
  );
}

/**
 * `currency` is the shop's, and it is threaded rather than looked up here so
 * every exporter states which currency its numbers are in. An order carries
 * its own — the shop may have changed currency since — so `exportOrders`
 * ignores this one and reads each row's.
 */
export async function runExport(
  type: ExportType,
  shopId: string,
  currency: string,
) {
  switch (type) {
    case "products":
      return {
        filename: "sailo-products.csv",
        body: await exportProducts(shopId, currency),
      };
    case "orders":
      return { filename: "sailo-orders.csv", body: await exportOrders(shopId) };
    case "clients":
      return {
        filename: "sailo-customers.csv",
        body: await exportClients(shopId, currency),
      };
  }
}
