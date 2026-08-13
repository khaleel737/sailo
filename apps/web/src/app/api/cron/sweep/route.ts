import { NextResponse } from "next/server";
import { cronAuthFailure } from "@/lib/cron-auth";
import { releaseAbandonedCheckouts } from "@sailo/commerce/inventory";
import { refreshCalendarFeeds } from "@/lib/booking/feed-health";
import { pruneWebhookDeliveries } from "@/lib/webhooks/deliver";

/**
 * Housekeeping that must happen whether or not a webhook arrived.
 *
 * Scheduled hourly in `vercel.json`. Everything it does is idempotent, so
 * running it twice — or by hand while debugging — is harmless.
 *
 * TODO(deletion): the 90-day file sweep. `deleteAccountFor` removes a departed
 * seller's images immediately but deliberately keeps their product *files*,
 * because a buyer who paid for a download still holds a live token and taking
 * the file away the moment the seller leaves punishes the wrong person. The
 * sweep this needs: for every shop whose `deletedAt` is more than 90 days old,
 * delete the remaining blobs and the `product_files` rows naming them. It
 * belongs here — hourly, idempotent, no request behind it — as a second
 * `await` and a second key in the response below. Until it lands the files
 * persist, which is the safe direction to be wrong in.
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

  return NextResponse.json({
    ok: true,
    abandonedCheckoutsReleased: abandoned.swept,
    calendarsChecked: calendars.checked,
    calendarsBroken: calendars.broken,
    webhookRowsPruned,
  });
}
