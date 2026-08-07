import { and, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { maybeRow } from "@/lib/invariant";
import { getDb } from "@/db";
import { orders, productFiles } from "@/db/schema";
import { orderedProductIds } from "@/lib/downloads";
import { isUuid } from "@/lib/utils";
import { isStoredFileUrl } from "@/lib/file-urls";

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
  if (!order) {
    return new Response("Not found", { status: 404 });
  }

  /*
   * Entitlement is every product on the order, not `order.productId` — that
   * column names the header's single line, and gating on it would refuse a
   * buyer the second half of what they paid for.
   */
  const productIds = await orderedProductIds(order);
  if (productIds.length === 0) {
    return new Response("Not found", { status: 404 });
  }

  const file = await db.query.productFiles.findFirst({
    where: and(
      eq(productFiles.id, fileId),
      inArray(productFiles.productId, productIds),
    ),
  });
  if (!file) {
    return new Response("Not found", { status: 404 });
  }

  // Claiming the download and checking whether one is left happen in the same
  // statement, so opening two tabs can't spend the last one twice.
  const claimed = maybeRow(await db
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
    .returning({ id: orders.id }));

  if (!claimed) {
    // Gone rather than Forbidden: the link was valid, its allowance isn't.
    return new Response("This download is no longer available.", {
      status: 410,
    });
  }

  /*
   * Checked again here, at the point the request is actually made.
   *
   * `saveProductFiles` is the gate, but this is the line that turns a stored
   * string into a server-side fetch whose body is streamed back to the caller.
   * Rows written before that gate existed still carry whatever was accepted
   * then, and a second write path added later would not know to ask. The check
   * belongs where the danger is, not only where the value arrives.
   */
  if (!isStoredFileUrl(file.url)) {
    console.error(`[sailo] refused an off-store file url on file ${file.id}`);
    // Give the download back, exactly as the upstream-failure branch below
    // does. The buyer got no bytes, and refusing a legacy row should not also
    // cost them an allowance they can never spend on it.
    await releaseDownload(db, order.id);
    return new Response("That file is temporarily unavailable.", { status: 502 });
  }

  /*
   * `redirect: "manual"`. The host check above is pre-flight, so following a
   * `Location` would let the one host it allows send us anywhere — the check
   * bypassed by the party it constrains. A stored file needs no redirect.
   */
  const upstream = await fetch(file.url, { redirect: "manual" });
  if (!upstream.ok || !upstream.body) {
    // Give the download back — the buyer didn't get anything for it.
    await releaseDownload(db, order.id);
    return new Response("That file is temporarily unavailable.", {
      status: 502,
    });
  }

  const filename = file.name.replace(/["\\\r\n]/g, "").slice(0, 120) || "download";
  // Read once: testing one call and asserting on a second says they must
  // agree, which is a claim about the header object rather than about a value.
  const length = upstream.headers.get("content-length");

  return new Response(upstream.body, {
    headers: {
      "Content-Type": file.contentType ?? "application/octet-stream",
      // The ASCII fallback keeps old clients happy; the UTF-8 form carries
      // names the buyer will actually recognise.
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      ...(length ? { "Content-Length": length } : {}),
      // A private link to private bytes: nothing about this is cacheable.
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * Hands an allowance back after a download that delivered nothing.
 *
 * The count is claimed before the fetch so two tabs cannot spend the last one
 * twice; every path that then fails to hand over bytes has to undo it, or the
 * buyer is charged an attempt for our failure. `greatest(…, 0)` so a double
 * release cannot give them more than they started with.
 */
async function releaseDownload(db: ReturnType<typeof getDb>, orderId: string) {
  await db
    .update(orders)
    .set({ downloadCount: sql`greatest(${orders.downloadCount} - 1, 0)` })
    .where(eq(orders.id, orderId));
}
