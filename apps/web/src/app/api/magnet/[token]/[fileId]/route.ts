import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { productFiles } from "@sailo/db/schema";
import { isUuid } from "@sailo/core/uuid";
import { rateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";
import {
  claimMagnetDownload,
  magnetForToken,
  releaseMagnetDownload,
} from "@sailo/marketing/leads/server";
import { streamStoredFile } from "@sailo/storage/stream";

/**
 * Streams one file of a lead magnet — spec 07.
 *
 * The shape of `/api/download/[token]/[fileId]` without any of the parts that
 * only make sense for an order: no membership entitlement, no
 * `download_events` (a free PDF is not chargeback evidence), and the allowance
 * is claimed on the lead rather than on an order. What *is* shared is the part
 * that matters — `streamStoredFile` holds the stored-file guard and the
 * no-redirect rule, so the one security-critical decision exists once.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/magnet/[token]/[fileId]">,
) {
  const { token, fileId } = await params;

  /*
   * Two ceilings, in this order, for the reason the order route gives: the
   * token comes from the URL, so a caller inventing a new one each time gets a
   * fresh bucket every request and the token limit never binds. The address
   * limit is what bounds that, and it sits first so a made-up token is refused
   * before it can buy a database query.
   */
  const byCaller = await rateLimit(`magnet-ip:${await callerIp()}`, 120, 300);
  if (!byCaller.allowed) {
    return new Response("Too many requests. Try again in a few minutes.", {
      status: 429,
    });
  }

  /*
   * DECISION B — fails closed. The token *is* the authorisation, so an
   * unmetered endpoint turns an offline guessing attack into an online one.
   */
  const gate = await rateLimit(`magnet:${token}`, 30, 300, { onOutage: "closed" });
  if (!gate.allowed) {
    return new Response("Too many requests. Try again in a few minutes.", {
      status: 429,
    });
  }

  if (!isUuid(fileId)) return new Response("Not found", { status: 404 });

  const grant = await magnetForToken(token);
  if (!grant) return new Response("Not found", { status: 404 });

  const file = await getDb().query.productFiles.findFirst({
    where: and(
      eq(productFiles.id, fileId),
      // Entitlement is this lead's product and nothing else — "single-audience",
      // which an order token is not: that one opens every file on the order.
      eq(productFiles.productId, grant.product.id),
    ),
  });
  if (!file) return new Response("Not found", { status: 404 });

  // Claimed in the statement that reads the count, so two open tabs cannot
  // spend the last allowance twice.
  if (!(await claimMagnetDownload(grant.lead.id, grant.product.downloadLimit))) {
    // Gone rather than Forbidden: the link was valid, its allowance is not.
    return new Response("This download is no longer available.", { status: 410 });
  }

  const streamed = await streamStoredFile(file);
  if (!streamed) {
    // Nothing was delivered, so the allowance goes back.
    await releaseMagnetDownload(grant.lead.id);
    return new Response("That file is temporarily unavailable.", { status: 502 });
  }
  return streamed;
}
