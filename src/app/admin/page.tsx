import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Eye,
  Package,
  ShoppingBag,
  Users,
} from "lucide-react";
import { requireShop } from "@/lib/session";
import {
  getDashboardStats,
  getShopOrders,
  getVisitSeries,
} from "@/lib/queries";
import { VisitsChart } from "@/components/admin/visits-chart";
import { CopyLink } from "@/components/admin/copy-link";
import { Badge, Card, EmptyState } from "@/components/ui";
import { formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Overview" };

const STATUS_TONE = {
  new: "blue",
  confirmed: "amber",
  fulfilled: "green",
  cancelled: "neutral",
} as const;

export default async function AdminOverviewPage() {
  const { shop } = await requireShop();
  const [stats, series, orders] = await Promise.all([
    getDashboardStats(shop.id),
    getVisitSeries(shop.id, 14),
    getShopOrders(shop.id, 5),
  ]);

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const shopUrl = `${base}/${shop.handle}`;
  const displayUrl = shopUrl.replace(/^https?:\/\//, "");

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 rounded-2xl bg-ink-900 p-5 text-white sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-white/50">
            Your shop link
          </p>
          <p className="mt-1 truncate text-lg font-semibold">{displayUrl}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <CopyLink url={shopUrl} />
          <a
            href={`/${shop.handle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-medium text-ink-900 transition hover:bg-ink-100"
          >
            Visit
            <ArrowRight className="size-3.5" />
          </a>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={<Eye className="size-4" />}
          label="Visits (30d)"
          value={stats.visits30d.toLocaleString()}
        />
        <Stat
          icon={<Users className="size-4" />}
          label="Unique visitors"
          value={stats.uniqueVisitors30d.toLocaleString()}
        />
        <Stat
          icon={<ShoppingBag className="size-4" />}
          label="Orders"
          value={stats.totalOrders.toLocaleString()}
          hint={stats.newOrders > 0 ? `${stats.newOrders} new` : undefined}
        />
        <Stat
          icon={<Package className="size-4" />}
          label="Products"
          value={stats.totalProducts.toLocaleString()}
          hint={
            stats.totalProducts > stats.publishedProducts
              ? `${stats.totalProducts - stats.publishedProducts} hidden`
              : undefined
          }
        />
      </div>

      {stats.awaitingConfirmation > 0 ? (
        <Link
          href="/admin/orders"
          className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 transition hover:bg-amber-100"
        >
          <p className="text-sm text-amber-900">
            <span className="font-medium">
              {stats.awaitingConfirmation}{" "}
              {stats.awaitingConfirmation === 1 ? "buyer says" : "buyers say"}
            </span>{" "}
            they&rsquo;ve sent payment. Confirm to mark as paid.
          </p>
          <ArrowRight className="size-4 shrink-0 text-amber-700" />
        </Link>
      ) : null}

      <Card className="mb-6 p-5">
        <VisitsChart data={series} />
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recent orders</h2>
          <Link
            href="/admin/orders"
            className="text-xs font-medium text-ink-500 transition hover:text-ink-900"
          >
            View all
          </Link>
        </div>

        {orders.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag className="size-7" />}
            title="No orders yet"
            description="When someone taps Order on your shop, their details land here — even before they message you."
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {orders.map((order) => (
              <li
                key={order.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {order.productTitle}
                    {order.quantity > 1 ? (
                      <span className="text-ink-400"> ×{order.quantity}</span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-ink-500">
                    {order.customerName ?? "Anonymous"} ·{" "}
                    {order.createdAt.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-medium tabular-nums">
                    {formatMoney(
                      order.unitPriceCents * order.quantity,
                      order.currency,
                    )}
                  </span>
                  <Badge tone={STATUS_TONE[order.status as keyof typeof STATUS_TONE] ?? "neutral"}>
                    {order.status}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5 text-ink-400">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-500">{hint}</p> : null}
    </Card>
  );
}
