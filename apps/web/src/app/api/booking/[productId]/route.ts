import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { liveShop } from "@/lib/shop-visibility";
import { products, shops } from "@sailo/db/schema";
import { isUuid } from "@sailo/core/uuid";
import { rateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";
import {
  BOOKING_HORIZON_DAYS,
  calendarWithStaff,
  isBookable,
} from "@sailo/commerce/booking/server";

/**
 * The times a buyer may pick, for one bookable service.
 *
 * Public and unauthenticated, like the shop page it serves. It reveals only
 * what the storefront already shows — when this shop is open and which of
 * those times are still free — and never why a time is gone, because "booked"
 * and "outside hours" are the same answer to someone who is not the seller.
 *
 * The answer is advisory. `createOrderIntent` re-derives it server-side before
 * writing anything, because a list handed to a browser is a snapshot and the
 * slot can be taken between reading it and ordering.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/booking/[productId]">,
) {
  // Cheap and read-only, but it runs a query per call and sits on a public
  // URL, so it gets the same kind of ceiling as the quote endpoint.
  const gate = await rateLimit(`slots:${await callerIp()}`, 120, 60);
  if (!gate.allowed) {
    return Response.json({ error: "Too many requests." }, { status: 429 });
  }

  const { productId } = await params;
  if (!isUuid(productId)) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const db = getDb();
  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.isPublished, true)),
    columns: {
      id: true,
      shopId: true,
      kind: true,
      bookingEnabled: true,
      bookingLeadHours: true,
      bookingBufferMinutes: true,
      durationMinutes: true,
    },
  });
  if (!product || !isBookable(product)) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  /*
   * The shop has to be live for its calendar to be. An unpublished or
   * suspended shop must not keep taking appointments through this route just
   * because the product row is still published.
   */
  const shop = await db.query.shops.findFirst({
    where: liveShop(eq(shops.id, product.shopId)),
    columns: {
      id: true,
      bookingHours: true,
      timeZone: true,
      bookingSlotMinutes: true,
      /*
       * The seller's own calendar, and what they pay for. Both read here
       * rather than fetched inside the calendar, so the plan gate is decided
       * from the same row that supplies the feed and cannot drift from it.
       */
      calendarFeedUrl: true,
      plan: true,
      subscriptionStatus: true,
      compPlan: true,
    },
  });
  if (!shop) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const requested = Number(new URL(request.url).searchParams.get("days") ?? 14);
  const days = Number.isFinite(requested)
    ? Math.max(1, Math.min(BOOKING_HORIZON_DAYS, Math.trunc(requested)))
    : 14;

  const now = new Date();
  /*
   * `calendarWithStaff` and not `calendarFor` — spec 51.
   *
   * A service with people on it offers the union of *their* free time. The
   * product-keyed calendar reads every order line for the service whoever took
   * it, so a salon with three stylists lost ten o'clock for all three the
   * moment one of them was booked — it offered less than the shop could sell,
   * which is the whole gap the roster exists to close.
   *
   * A shop with no `staff_resources` rows — which is every shop the day this
   * ships — gets `calendarFor` unchanged, and the fallback is the data rather
   * than a branch anybody has to remember.
   */
  const calendar = await calendarWithStaff(shop, product, { days, now });

  return Response.json(
    {
      timeZone: shop.timeZone,
      durationMinutes: product.durationMinutes,
      days: calendar.map((day) => ({
        date: day.date,
        slots: day.slots.map((slot) => slot.startsAt.toISOString()),
      })),
    },
    {
      headers: {
        // Availability changes the moment somebody books. A cached calendar
        // would offer a slot that is already gone.
        "Cache-Control": "private, no-store",
      },
    },
  );
}
