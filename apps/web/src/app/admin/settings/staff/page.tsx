import type { Metadata } from "next";
import { UsersRound } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getAdminT, getT } from "@/i18n/server";
import { can } from "@sailo/core/plans";
import { hoursOf } from "@sailo/commerce/booking";
import { listStaff } from "@sailo/commerce/booking/server";
import { LockedFeature } from "@/app/admin/_components/locked-feature";
import { StaffCard, type RosterPerson } from "./_components/staff-card";

export const metadata: Metadata = { title: "Who takes bookings" };
export const instant = false;

/**
 * Spec 51's roster.
 *
 * ## Why it is here and not in the product form
 *
 * The roster is **shop-wide** and the assignment is **per product**, and those
 * are two questions with two answers. Sam is one person who takes bookings for
 * the cut, the colour and the beard trim; putting the editor on the service
 * would make every service page a place to create shop-wide records, and a
 * salon with three stylists and four services would have twelve chances to end
 * up with three Sams. It also has hours, a zone and a calendar address — a
 * person's whole working week, sitting inside the form for one haircut.
 *
 * So: who exists lives in Settings, beside the shop's own opening hours, which
 * is the setting it falls back to. Which of them takes *this* service lives on
 * the service, in `ServiceSettingsCard`, where the seller is already deciding
 * how that service is booked.
 *
 * ## The plan gate falls back rather than refusing
 *
 * A shop with rows and no plan sees them, can still edit them, and can still
 * take somebody off the rota — only hiring is withheld. The full upsell wall is
 * for a shop with nothing to keep, where there is no data to fall back to and
 * the screen would otherwise be an empty list nobody can act on.
 */
export default async function StaffSettingsPage() {
  const { shop } = await requireShop("settings:read");
  const { a } = await getAdminT();

  const staff = await listStaff(shop.id);
  const unlocked = can(shop, "staffResources");

  if (!unlocked && staff.length === 0) {
    const { t } = await getT();
    return (
      <LockedFeature
        shop={shop}
        feature="staffResources"
        icon={<UsersRound className="size-8" />}
        title={a.productForm.staffTitle}
        description={a.productForm.staffBody}
        t={t}
      />
    );
  }

  /*
   * The feed URL is replaced by its hostname on the way to the card.
   *
   * It is a bearer token for somebody's whole calendar, and the card is a
   * client component — a prop is an RSC payload is a view-source. The same
   * rule the code pool follows: counts cross the boundary, codes do not.
   */
  const roster: RosterPerson[] = staff.map((person) => ({
    id: person.id,
    name: person.name,
    email: person.email,
    hours: person.hours,
    timeZone: person.timeZone,
    isActive: person.isActive,
    feedHost: hostOf(person.calendarFeedUrl),
  }));

  return (
    <StaffCard
      roster={roster}
      /* What a person's blank hours actually mean, so the editor opens on the
         week they are falling back to rather than on nine-to-five. */
      shopHours={hoursOf(shop.bookingHours)}
      shopTimeZone={shop.timeZone}
      unlocked={unlocked}
    />
  );
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
