import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { CalendarClock, MapPin, Video } from "lucide-react";
import { getDb } from "@sailo/db";
import { tickets } from "@sailo/db/schema";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { shopEvents } from "@/lib/queries/tickets";
import { normalizeTicketCode } from "@sailo/commerce/ticketing";
import { PageHeader } from "@sailo/design-system/web";
import { Card, EmptyState } from "@sailo/design-system/web";

export const metadata: Metadata = { title: "Check-in" };

/**
 * Which door, before anything else.
 *
 * This page used to be the whole feature: one box, one button, shop-wide. A
 * shop running two events on one night had no way to say which one a
 * volunteer was standing at, so a ticket for the wrong room read as perfectly
 * valid and the counts — such as they were — mixed both audiences together.
 */
export default async function AdminCheckinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { shop } = await requireShop();
  const { a } = await getAdminT();
  const params = await searchParams;

  /*
   * Every ticket already in a buyer's inbox carries a QR pointing here with
   * `?code=`, and those keep turning up at doors for as long as the events
   * they belong to are in the future. Resolve the code to its event and
   * forward, so an old QR opens the right door in one step rather than a
   * picker the volunteer then has to read in the dark.
   */
  const raw = typeof params.code === "string" ? params.code : "";
  if (raw) {
    const code = normalizeTicketCode(raw);
    const ticket = code
      ? await getDb().query.tickets.findFirst({
          where: and(eq(tickets.code, code), eq(tickets.shopId, shop.id)),
          columns: { productId: true },
        })
      : null;
    if (ticket?.productId) {
      redirect(
        `/admin/checkin/${ticket.productId}?code=${encodeURIComponent(code)}`,
      );
    }
  }

  const events = await shopEvents(shop.id);

  // One live door is not a choice, it is a step. Skip it.
  const only = events[0];
  if (events.length === 1 && only && !raw) {
    redirect(`/admin/checkin/${only.id}`);
  }

  return (
    <>
      <PageHeader title={a.checkin.title} description={a.checkin.description} />

      {events.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="size-6" />}
          title={a.checkin.noEvents}
          description={a.checkin.noEventsBody}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {events.map((event) => {
            const percent =
              event.issued > 0
                ? Math.round((event.checkedIn / event.issued) * 100)
                : 0;
            return (
              <Link
                key={event.id}
                href={`/admin/checkin/${event.id}`}
                className="focus-ring rounded-2xl"
              >
                <Card className="h-full p-5 transition-shadow hover:shadow-md">
                  <p className="truncate text-sm font-semibold text-ink-900">
                    {event.title}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-500">
                    {event.online ? (
                      <Video className="size-3.5 shrink-0" />
                    ) : (
                      <MapPin className="size-3.5 shrink-0" />
                    )}
                    <span className="truncate">
                      {event.startsAt
                        ? interpolate(a.checkin.startsAt, {
                            when: event.startsAt.toLocaleString(undefined, {
                              weekday: "short",
                              day: "numeric",
                              month: "short",
                              hour: "numeric",
                              minute: "2-digit",
                            }),
                          })
                        : (event.location ?? "")}
                    </span>
                  </p>

                  <p className="tabular mt-4 text-2xl font-bold text-ink-900">
                    {interpolate(a.checkin.inOf, {
                      checkedIn: event.checkedIn,
                      issued: event.issued,
                    })}
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
