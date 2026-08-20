import { NextResponse } from "next/server";
import { getDownloadByToken } from "@sailo/commerce/orders/server";
import {
  buildIcs,
  eventAccessForOrder,
  icsFilename,
  icsUid,
} from "@sailo/commerce/ticketing";

/**
 * The calendar entry a ticket buyer expects — spec 50, finally reachable.
 *
 * `ics.ts` shipped with the wave and had no callers at all: a stable UID per
 * (order, session), a `SEQUENCE` that lets a reissue update rather than
 * duplicate, a `VTIMEZONE` so an entry can say "19:00 Gulf Standard Time" to
 * somebody reading it in London — and nothing anywhere produced a file. Its own
 * header calls it the highest ratio of "buyer expects it" to lines of code in
 * the plan, which is only true once something serves it.
 *
 * WHY THIS ROUTE AND NOT A DATA URL ON THE PAGE
 *
 * The delivery page is where a buyer lands after paying and the one thing they
 * reliably do there is add the date to their diary. A route can be linked from
 * the confirmation email too, which a data URL cannot — mail clients strip
 * them — and it keeps one implementation for both surfaces.
 *
 * THE GATE IS THE TOKEN, AND NOTHING ELSE IS TRUSTED
 *
 * The path carries the order's own download token, exactly as the page does, and
 * `eventAccessForOrder` decides on its own whether this order has earned its
 * join link — it returns one only once `downloadReleasedAt` is set. So an
 * unpaid order gets a calendar entry with the *time and place* and no link,
 * which is the honest answer: knowing when a thing starts was never the secret,
 * and the join URL is the thing being sold.
 *
 * `product` and `session` narrow the list to one entry. Both are matched
 * against what `eventAccessForOrder` returned rather than looked up, so a
 * forged pair names nothing and gets a 404 rather than another order's event.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const record = await getDownloadByToken(token);
  if (!record) return new NextResponse("Not found", { status: 404 });

  const url = new URL(request.url);
  const productId = url.searchParams.get("product");
  const sessionId = url.searchParams.get("session");

  const events = await eventAccessForOrder(record.order);

  /*
   * A named product must match, and a named one that does not is a 404.
   *
   * The fallback is only for a request that named *nothing* — the ordinary
   * single-event order, where the page should not have to spell out what it
   * already knows there is one of. Letting the fallback also catch a request
   * whose product simply did not match would make the parameter decorative:
   * ask for somebody else's event on your own token and you would get your own
   * back with a 200, which is a confusing answer to an unambiguous question.
   */
  const event = productId
    ? events.find(
        (row) =>
          row.productId === productId &&
          (row.sessionId ?? "") === (sessionId ?? ""),
      )
    : events.length === 1
      ? events[0]
      : undefined;

  if (!event?.startsAt) return new NextResponse("Not found", { status: 404 });

  const body = buildIcs({
    /*
     * Stable per (order, date) — the whole reason a resend updates the entry
     * the attendee already has instead of adding a second one to their diary.
     */
    uid: icsUid(record.order.id, event.sessionId),
    /*
     * Zero until something can actually revise an entry.
     *
     * `SEQUENCE` has to *increase* for a client to accept an update, so it must
     * come from a stored number rather than a clock or a guess — a value that
     * moved backwards would make a real reschedule silently ignored. Nothing
     * reschedules an event yet, so zero is the honest starting point and the
     * column that will feed this is a change to make when it does.
     */
    sequence: 0,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    summary: event.title,
    location: event.location,
    /*
     * Null until the order is released — `eventAccessForOrder` decides that, so
     * an abandoned checkout's calendar entry carries the date and not the link.
     */
    url: event.joinUrl,
    /*
     * This event's own zone, falling back to the shop's.
     *
     * From `event`, not from `record.product` — that is the *order header's*
     * product, and a basket holding a mug and a webinar would have labelled the
     * webinar with whatever zone the mug's row carried. `DTSTART` is UTC either
     * way, so the instant was never wrong; the label a reader in London sees
     * beside it was.
     */
    timeZone: event.timeZone ?? record.shop.timeZone,
    organizer: {
      name: record.shop.name,
      email: record.shop.contactEmail,
    },
  });

  return new NextResponse(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${icsFilename(event.title)}"`,
      /*
       * A private link, and one whose contents change the moment the seller
       * moves the date. Neither a browser nor a proxy may keep it.
       */
      "cache-control": "no-store",
    },
  });
}
