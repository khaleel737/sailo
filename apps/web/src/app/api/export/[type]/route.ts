import { NextResponse } from "next/server";
import { requireShop } from "@/lib/session";
import { can, cheapestPlanWith } from "@sailo/core/plans";
import { csvResponse } from "@/lib/csv";
import { isExportType, runExport } from "@/lib/exporters";
import { rateLimit } from "@sailo/rate-limit";
import { isUuid } from "@sailo/core/uuid";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/export/[type]">,
) {
  // Redirects when signed out, so exports are never publicly reachable.
  const { shop } = await requireShop("customers:export");
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

  /*
   * The selection bar's "Export selected" — uuids only, capped at the list
   * page's own size, and still narrowed to this shop inside the exporter.
   * Anything malformed simply falls out, leaving the full export, which is
   * the harmless answer.
   */
  const idsParam = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = idsParam
    .split(",")
    .filter(isUuid)
    .slice(0, 100);

  const { filename, body } = await runExport(
    type,
    shop.id,
    shop.currency,
    ids.length > 0 ? ids : undefined,
  );
  return csvResponse(filename, body);
}
