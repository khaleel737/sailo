import { NextResponse } from "next/server";
import { requireShop } from "@/lib/session";
import { can, cheapestPlanWith } from "@/lib/plans";
import { csvResponse } from "@/lib/csv";
import { isExportType, runExport } from "@/lib/exporters";
import { rateLimit } from "@/lib/redis";

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

  /*
   * A guard and a plan gate, but no ceiling — and this reads a shop's entire
   * catalogue, order history or customer list per call. Keyed per shop rather
   * than per address: a seller exporting three files in a row is the normal
   * case and must not be throttled by whoever shares their office network.
   */
  const gate = await rateLimit(`export:${shop.id}`, 20, 300);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: "Too many exports just now. Wait a moment and try again." },
      { status: 429 },
    );
  }

  const { filename, body } = await runExport(type, shop.id, shop.currency);
  return csvResponse(filename, body);
}
