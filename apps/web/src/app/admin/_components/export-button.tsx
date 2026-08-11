import Link from "next/link";
import { Download, Lock } from "lucide-react";
import { can, cheapestPlanWith } from "@/lib/plans";
import { getAdminT } from "@/i18n/server";
import { interpolate } from "@/i18n";
import type { Shop } from "@sailo/db/schema";

/**
 * Export link for a list page. When the plan doesn't allow it, this points at
 * billing rather than disappearing — a hidden feature can't be upgraded to.
 */
export async function ExportButton({
  shop,
  type,
}: {
  shop: Shop;
  type: "products" | "orders" | "clients";
}) {
  const { a } = await getAdminT();
  if (can(shop, "csvExport")) {
    return (
      <a
        href={`/api/export/${type}`}
        className="inline-flex h-10 items-center gap-2 rounded-xl pointer-coarse:h-11 border border-ink-200 bg-white px-4 text-sm font-medium text-ink-900 transition hover:bg-ink-50"
      >
        <Download className="size-4" />
        {a.data.export}
      </a>
    );
  }

  const plan = cheapestPlanWith("csvExport");
  return (
    <Link
      href="/admin/settings/billing"
      title={interpolate(a.data.exportsOnPlan, { plan: plan?.name ?? "—" })}
      className="inline-flex h-10 items-center gap-2 rounded-xl pointer-coarse:h-11 border border-ink-200 bg-white px-4 text-sm font-medium text-ink-400 transition hover:text-ink-900"
    >
      <Lock className="size-3.5" />
      {a.data.export}
    </Link>
  );
}
