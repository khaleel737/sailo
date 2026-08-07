import { NextResponse } from "next/server";
import { requireShop } from "@/lib/session";
import { can, cheapestPlanWith } from "@/lib/plans";
import { csvResponse } from "@/lib/csv";
import { isExportType, runExport } from "@/lib/exporters";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/export/[type]">,
) {
  // Redirects when signed out, so exports are never publicly reachable.
  const { shop } = await requireShop();
  const { type } = await params;

  if (!isExportType(type)) {
    return NextResponse.json({ error: "Unknown export type" }, { status: 404 });
  }

  if (!can(shop, "csvExport")) {
    const plan = cheapestPlanWith("csvExport");
    return NextResponse.json(
      { error: `Exports are available on ${plan?.name ?? "a paid plan"}.` },
      { status: 402 },
    );
  }

  const { filename, body } = await runExport(type, shop.id, shop.currency);
  return csvResponse(filename, body);
}
