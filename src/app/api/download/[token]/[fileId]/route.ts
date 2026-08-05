import { and, eq, isNotNull, isNull, or, gt, sql } from "drizzle-orm";
import { firstRow } from "@/lib/invariant";
import { getDb } from "@/db";
import { orders, productFiles } from "@/db/schema";
import { isUuid } from "@/lib/utils";

/**
 * Streams one file of a digital order.
 *
 * The buyer's link names their order, never the file's storage address: the
 * bytes come back through here so the rules — released, not expired, still
 * within the download cap — are checked on every single request, and so a
 * shared URL can't outlive them.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/download/[token]/[fileId]">,
) {
  const { token, fileId } = await params;
  const db = getDb();

  if (!isUuid(fileId)) {
    return new Response("Not found", { status: 404 });
  }

  const order = await db.query.orders.findFirst({
    where: eq(orders.downloadToken, token),
  });
  if (!order || !order.productId) {
    return new Response("Not found", { status: 404 });
  }

  const file = await db.query.productFiles.findFirst({
    where: and(
      eq(productFiles.id, fileId),
      // Belonging to the ordered product is what entitles the buyer to it.
      eq(productFiles.productId, order.productId),
    ),
  });
  if (!file) {
    return new Response("Not found", { status: 404 });
  }

  // Claiming the download and checking whether one is left happen in the same
  // statement, so opening two tabs can't spend the last one twice.
  const claimed = firstRow(await db
    .update(orders)
    .set({ downloadCount: sql`${orders.downloadCount} + 1` })
    .where(
      and(
        eq(orders.id, order.id),
        isNotNull(orders.downloadReleasedAt),
        or(
          isNull(orders.downloadExpiresAt),
          gt(orders.downloadExpiresAt, new Date()),
        ),
        or(
          isNull(orders.downloadLimit),
          sql`${orders.downloadCount} < ${orders.downloadLimit}`,
        ),
      ),
    )
    .returning({ id: orders.id }), "claimed");

  if (!claimed) {
    // Gone rather than Forbidden: the link was valid, its allowance isn't.
    return new Response("This download is no longer available.", {
      status: 410,
    });
  }

  const upstream = await fetch(file.url);
  if (!upstream.ok || !upstream.body) {
    // Give the download back — the buyer didn't get anything for it.
    await db
      .update(orders)
      .set({ downloadCount: sql`greatest(${orders.downloadCount} - 1, 0)` })
      .where(eq(orders.id, order.id));
    return new Response("That file is temporarily unavailable.", {
      status: 502,
    });
  }

  const filename = file.name.replace(/["\\\r\n]/g, "").slice(0, 120) || "download";

  return new Response(upstream.body, {
    headers: {
      "Content-Type": file.contentType ?? "application/octet-stream",
      // The ASCII fallback keeps old clients happy; the UTF-8 form carries
      // names the buyer will actually recognise.
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      ...(upstream.headers.get("content-length")
        ? { "Content-Length": upstream.headers.get("content-length")! }
        : {}),
      // A private link to private bytes: nothing about this is cacheable.
      "Cache-Control": "private, no-store",
    },
  });
}
