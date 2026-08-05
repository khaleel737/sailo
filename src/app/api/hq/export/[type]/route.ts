import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/session";
import { bool, csvResponse, date, money, toCsv } from "@/lib/csv";
import {
  getAllAccountsForExport,
  getAllAffiliatesForExport,
  getAllBuyersForExport,
  getAllOrdersForExport,
  getAllProductsForExport,
  getPaidAccounts,
} from "@/lib/hq";
import { billingState, planMonthlyCents } from "@/lib/hq-metrics";
import { planFor } from "@/lib/plans";

/**
 * Platform-wide CSV exports, for the spreadsheet work no dashboard replaces —
 * a board deck, a cohort chart, a mail merge to every seller who hasn't
 * published yet.
 *
 * Behind `requireStaff()` like every other /hq surface. This is the one place
 * that hands over every account in one file, so it is worth saying plainly:
 * the guard is the whole security model, and it is the first line of the
 * handler for that reason.
 */

const EXPORTS = [
  "accounts",
  "subscriptions",
  "orders",
  "products",
  "affiliates",
  "buyers",
] as const;
type ExportType = (typeof EXPORTS)[number];

function isExportType(value: string): value is ExportType {
  return (EXPORTS as readonly string[]).includes(value);
}

export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/hq/export/[type]">,
) {
  await requireStaff();
  const { type } = await params;

  if (!isExportType(type)) {
    return NextResponse.json({ error: "Unknown export" }, { status: 404 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const { headers, rows } = await build(type);
  return csvResponse(`sailo-${type}-${stamp}.csv`, toCsv(headers, rows));
}

async function build(
  type: ExportType,
): Promise<{ headers: string[]; rows: unknown[][] }> {
  switch (type) {
    case "accounts": {
      const accounts = await getAllAccountsForExport();
      return {
        headers: [
          "Registered",
          "Name",
          "Email",
          "Email verified",
          "Shop",
          "Handle",
          "Shop created",
          "Published",
          "Suspended",
          "Currency",
          "Entitled plan",
          "Billing state",
          "MRR (USD)",
          "Products",
          "Orders",
          "Volume (shop currency)",
          "Stripe customer",
          "Connect account",
          "Internal note",
        ],
        rows: accounts.map((a) => {
          const shop = a.shop;
          return [
            date(a.joinedAt),
            a.name,
            a.email,
            bool(a.emailVerified),
            shop?.name ?? "",
            shop?.handle ?? "",
            date(shop?.createdAt),
            shop ? bool(shop.isPublished) : "",
            shop?.suspendedAt ? date(shop.suspendedAt) : "",
            shop?.currency ?? "",
            shop ? planFor(shop).name : "",
            shop ? billingState(shop) : "no shop",
            shop ? money(planMonthlyCents(shop)) : "",
            a.productCount,
            a.orderCount,
            money(a.gmvCents),
            shop?.stripeCustomerId ?? "",
            shop?.stripeAccountId ?? "",
            shop?.staffNote ?? "",
          ];
        }),
      };
    }

    case "subscriptions": {
      const paid = await getPaidAccounts();
      return {
        headers: [
          "Shop",
          "Handle",
          "Owner",
          "Email",
          "Entitled plan",
          "Billing state",
          "Stripe plan",
          "Interval",
          "Stripe status",
          "MRR (USD)",
          "Renews",
          "Cancelling",
          "Comped plan",
          "Comp reason",
          "Stripe customer",
          "Stripe subscription",
        ],
        rows: paid.map(({ shop, ownerName, ownerEmail }) => [
          shop.name,
          shop.handle,
          ownerName,
          ownerEmail,
          planFor(shop).name,
          billingState(shop),
          shop.plan,
          shop.subscriptionInterval ?? "",
          shop.subscriptionStatus ?? "",
          money(planMonthlyCents(shop)),
          date(shop.currentPeriodEnd),
          bool(shop.cancelAtPeriodEnd),
          shop.compPlan ?? "",
          shop.compNote ?? "",
          shop.stripeCustomerId ?? "",
          shop.stripeSubscriptionId ?? "",
        ]),
      };
    }

    case "orders": {
      const rows = await getAllOrdersForExport();
      return {
        headers: [
          "Placed",
          "Shop",
          "Handle",
          "Seller email",
          "Order id",
          "Item",
          "Items",
          "Currency",
          "Subtotal",
          "Discount",
          "Delivery",
          "Tax",
          "Total",
          "Refunded",
          "Payment method",
          "Payment status",
          "Status",
          "Buyer",
          "Buyer email",
          "Coupon",
          "Affiliate code",
          "Commission",
        ],
        rows: rows.map(({ order, shopName, shopHandle, ownerEmail }) => [
          date(order.createdAt),
          shopName,
          shopHandle,
          ownerEmail,
          order.id,
          order.productTitle,
          order.itemCount,
          order.currency,
          money(order.subtotalCents),
          money(order.discountCents),
          money(order.deliveryFeeCents),
          money(order.taxCents),
          money(order.totalCents),
          money(order.refundedCents),
          order.paymentMethod,
          order.paymentStatus,
          order.status,
          order.customerName ?? "",
          order.customerEmail ?? "",
          order.couponCode ?? "",
          order.affiliateCode ?? "",
          money(order.commissionCents),
        ]),
      };
    }

    case "products": {
      const rows = await getAllProductsForExport();
      return {
        headers: [
          "Added",
          "Shop",
          "Handle",
          "Title",
          "Slug",
          "Kind",
          "Currency",
          "Price",
          "Compare at",
          "Published",
          "In stock",
          "Tracks inventory",
          "Stock",
        ],
        rows: rows.map(({ product, shopName, shopHandle, currency }) => [
          date(product.createdAt),
          shopName,
          shopHandle,
          product.title,
          product.slug,
          product.kind,
          currency,
          money(product.priceCents),
          money(product.compareAtCents),
          bool(product.isPublished),
          bool(product.inStock),
          bool(product.trackInventory),
          product.stockQuantity ?? "",
        ]),
      };
    }

    case "affiliates": {
      const rows = await getAllAffiliatesForExport();
      return {
        headers: [
          "Joined",
          "Shop",
          "Name",
          "Email",
          "Code",
          "Status",
          "Source",
          "Commission %",
          "Clicks",
          "Orders",
          "Currency",
          "Earned",
          "Unpaid",
        ],
        rows: rows.map((r) => [
          date(r.affiliate.createdAt),
          r.shopHandle,
          r.affiliate.name,
          r.affiliate.email ?? "",
          r.affiliate.code,
          r.affiliate.status,
          r.affiliate.source,
          r.affiliate.commissionBp === null
            ? "shop default"
            : (r.affiliate.commissionBp / 100).toFixed(2),
          r.affiliate.clicks,
          r.orderCount,
          r.currency,
          money(r.earnedCents),
          money(r.unpaidCents),
        ]),
      };
    }

    case "buyers": {
      const rows = await getAllBuyersForExport();
      return {
        headers: [
          "First seen",
          "Shop",
          "Name",
          "Email",
          "Phone",
          "City",
          "Country",
          "Orders",
          "Currency",
          "Spent",
        ],
        rows: rows.map((r) => [
          date(r.client.createdAt),
          r.shopHandle,
          r.client.name,
          r.client.email ?? "",
          r.client.phone ?? "",
          r.client.city ?? "",
          r.client.country ?? "",
          r.orderCount,
          r.currency,
          money(r.spentCents),
        ]),
      };
    }
  }
}
