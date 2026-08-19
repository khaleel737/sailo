import { NextResponse } from "next/server";
import { cronAuthFailure } from "@sailo/security/cron-auth";
import { releaseAbandonedCheckouts } from "@sailo/commerce/catalog";
import { refreshCalendarFeeds } from "@sailo/commerce/booking/server";
import { pruneWebhookDeliveries } from "@sailo/workflows/webhooks";
import { sweepDeletedShopFiles } from "@sailo/account/deletion";
import { expireDataExports } from "@sailo/account/data-requests";

/**
 * Housekeeping that must happen whether or not a webhook arrived.
 *
 * Scheduled hourly in `vercel.json`. Everything it does is idempotent, so
 * running it twice — or by hand while debugging — is harmless.
 *
 * The 90-day file sweep that used to be a TODO here is now
 * `sweepDeletedShopFiles`, below. It was the last piece of personal data on the
 * platform with no deletion path at all, which is why spec 52 could not honestly
 * ship without it: promising a buyer a statutory erasure on top of a store that
 * cannot erase is a promise worse than not making it.
 */
export async function GET(request: Request) {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  const abandoned = await releaseAbandonedCheckouts();
  /*
   * Whether each connected calendar still answers.
   *
   * Here rather than on the booking page, because the read path runs on a
   * public route and must not turn a page view into an UPDATE — and because
   * a feed that has quietly stopped parsing hides no slots, so without
   * somebody asking on a schedule the seller's first evidence is a buyer
   * booking over their holiday.
   */
  const calendars = await refreshCalendarFeeds();

  /*
   * Webhook deliveries older than thirty days.
   *
   * Here rather than in the delivery cron because pruning is housekeeping, not
   * delivery, and because this is the one table in the schema whose row count
   * grows with a shop's *traffic* times its endpoints rather than with its
   * orders. Nothing reads a delivery older than the log's own window.
   */
  const webhookRowsPruned = await pruneWebhookDeliveries();

  /*
   * A departed seller's product files, ninety days after they left.
   *
   * Spec 03 keeps them on purpose — a buyer who paid for a download still holds
   * a live token — and named this route as where they would finally go. Listed
   * out of the blob store by the shop's own path prefix rather than read from
   * rows, because `hardDeleteShopContent` takes `products` and `product_files`
   * cascades with them: by ninety days there is nothing in the database naming
   * the objects. See `@sailo/account/deletion/sweep`.
   */
  const files = await sweepDeletedShopFiles();

  /*
   * And the other direction: personal-data exports assembled for a buyer's
   * subject access request, past their expiry. An orphaned export in Blob is the
   * incident spec 52 exists to prevent, so the link expiring and the bytes going
   * are the same tick rather than two.
   */
  const exports_ = await expireDataExports();

  return NextResponse.json({
    ok: true,
    abandonedCheckoutsReleased: abandoned.swept,
    calendarsChecked: calendars.checked,
    calendarsBroken: calendars.broken,
    webhookRowsPruned,
    deletedShopsSwept: files.shopsSwept,
    deletedFilesRemoved: files.blobsDeleted,
    dataExportsExpired: exports_.expired,
  });
}
