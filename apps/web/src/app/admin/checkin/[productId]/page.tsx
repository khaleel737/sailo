import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Download, KeyRound } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { can } from "@sailo/core/plans";
import {
  eventDoorList,
  eventDoorStats,
  eventTiers,
  getShopEvent,
} from "@sailo/commerce/ticketing";
import { PageHeader } from "@sailo/design-system/web";
import { Button } from "@sailo/design-system/web";
import { DoorConsole } from "../_components/door-console";
import { ImportPanel } from "@/app/admin/settings/data/_components/import-panel";

export const metadata: Metadata = { title: "Check-in" };

/**
 * One event's door, on the seller's own phone.
 *
 * Everything is loaded once on the server and handed to the console as
 * initial state; from there the screen talks to server actions directly. A
 * door works over venue wifi and a full page render per guest is the
 * difference between a queue that moves and one that doesn't.
 */
export default async function EventDoorPage({
  params,
  searchParams,
}: PageProps<"/admin/checkin/[productId]">) {
  const { shop } = await requireShop("orders:read");
  const { a } = await getAdminT();
  const { productId } = await params;
  const query = await searchParams;

  const event = await getShopEvent(shop.id, productId);
  if (!event) notFound();

  const [stats, rows, tiers] = await Promise.all([
    eventDoorStats(shop.id, productId),
    eventDoorList(shop.id, productId, { status: "all" }, 100),
    eventTiers(shop.id, productId),
  ]);

  return (
    <>
      <PageHeader
        title={event.title}
        description={
          event.eventStartsAt
            ? event.eventStartsAt.toLocaleString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
                hour: "numeric",
                minute: "2-digit",
              })
            : (event.serviceLocation ?? undefined)
        }
        back={{ href: "/admin/checkin", label: a.checkin.title }}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/admin/checkin/${productId}/passes`}>
              <Button variant="secondary">
                <KeyRound className="size-4" />
                {a.checkin.passes}
              </Button>
            </Link>
            {/* Plan-gated the same way every other export is, and reached by
                the same route — this is one more `type`, not a new door. */}
            {can(shop, "csvExport") ? (
              <a href="/api/export/attendees" download>
                <Button variant="secondary">
                  <Download className="size-4" />
                  {a.checkin.exportDoorList}
                </Button>
              </a>
            ) : null}
          </div>
        }
      />

      <div className="mx-auto max-w-lg space-y-4">
        <DoorConsole
          productId={productId}
          initialStats={stats}
          initialRows={rows}
          tiers={tiers}
          labels={a.checkin}
          /* The code an old QR carried, so scanning one still admits in a
             single step rather than landing on an empty screen. */
          initialCode={typeof query.code === "string" ? query.code : null}
        />

        <ImportPanel
          type="tickets"
          productId={productId}
          title={a.checkin.importTitle}
          description={a.checkin.importBody}
          columns={[
            { name: "Attendee Name", note: "who the ticket is for" },
            { name: "Attendee Email", note: "optional; used to avoid duplicates" },
            { name: "Quantity", note: "how many admissions — blank means one" },
            { name: "Tier", note: "optional, e.g. VIP" },
            { name: "Note", note: "optional; shows beside their name at the door" },
            {
              name: "Event",
              note: "only needed when one file covers several events",
            },
          ]}
        />
      </div>
    </>
  );
}
