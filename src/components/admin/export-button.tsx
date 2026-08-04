import Link from "next/link";
import { Download, Lock } from "lucide-react";
import { can, cheapestPlanWith } from "@/lib/plans";
import type { Shop } from "@/db/schema";

/**
 * Export link for a list page. When the plan doesn't allow it, this points at
 * billing rather than disappearing — a hidden feature can't be upgraded to.
 */
export function ExportButton({
  shop,
  type,
}: {
  shop: Shop;
  type: "products" | "orders" | "clients";
}) {
  if (can(shop, "csvExport")) {
    return (
      <a
        href={`/api/export/${type}`}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 text-sm font-medium text-ink-900 transition hover:bg-ink-50"
      >
        <Download className="size-4" />
        Export
      </a>
    );
  }

  const plan = cheapestPlanWith("csvExport");
  return (
    <Link
      href="/admin/settings/billing"
      title={`Exports are available on ${plan?.name}`}
      className="inline-flex h-10 items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 text-sm font-medium text-ink-400 transition hover:text-ink-900"
    >
      <Lock className="size-3.5" />
      Export
    </Link>
  );
}
