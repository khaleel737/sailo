"use server";

import { revalidatePath } from "next/cache";
import { requireShop } from "@/lib/session";
import { can, cheapestPlanWith } from "@sailo/core/plans";
import { readBookingHours, readTimeZone } from "./shop-form";
import {
  saveStaff,
  setStaffActive,
  type SaveStaffRefusal,
} from "@sailo/commerce/booking/server";
import type { ActionState } from "@sailo/core/action-state";

/**
 * The roster screen's writes — spec 51.
 *
 * `staff_resources` is *who a buyer books*, which is not `shopMembers` and not
 * `staff_members`: a stylist is a bookable resource, a team member is a login,
 * and Sailo's own staff are neither. Three tables and one word, so the file is
 * named after the screen it serves and says this at the top.
 *
 * Both writes name `settings:write`, which is the owner alone today. The
 * roster is shop-wide configuration in the same sense the opening hours are —
 * it decides what the storefront will promise, on every service at once — and
 * `settings` is precisely the resource a manager holds read-only so that
 * running the shop day to day cannot change what the shop *is*.
 */

/** The seller's own words for each refusal the domain can return. */
function sentenceFor(refusal: SaveStaffRefusal): string {
  switch (refusal.kind) {
    case "no_name":
      return "Give this person a name.";
    case "not_found":
      return "That person isn't on your roster.";
    case "feed_not_public":
      return "That calendar link must be a public https:// or webcal:// address.";
    case "roster_full":
      return `You can have up to ${refusal.limit} people taking bookings.`;
  }
}

/**
 * Adding somebody, or editing them.
 *
 * One action for both, because the form is the same form: an `id` edits and no
 * `id` adds, exactly as `saveProduct` reads it.
 */
export async function saveStaffMember(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop } = await requireShop("settings:write");

  /*
   * Gated here as well as on the page, because a form is not a gate: a
   * hand-rolled POST does not render a card, and a shop that downgrades keeps
   * every row it wrote. Refusing the *write* rather than the read is where the
   * line falls for this feature — a downgraded seller can still see who is on
   * their roster and can still stop offering them.
   */
  if (!can(shop, "staffResources")) {
    const plan = cheapestPlanWith("staffResources");
    return {
      ok: false,
      error: `Booking staff are on ${plan?.name ?? "a paid plan"}.`,
    };
  }

  const id = String(formData.get("id") ?? "").trim() || null;

  /*
   * Blank hours mean the shop's, and the checkbox is what says so.
   *
   * The hidden field the editor maintains always carries a week, so "use the
   * shop's hours" cannot be expressed by emptying it — the seller would have
   * to close all seven days, which means something else entirely.
   */
  const ownHours = formData.get("staffOwnHours") === "on";
  const hours = ownHours ? readBookingHours(formData.get("staffHours")) : null;

  /*
   * Blank leaves the stored feed alone; the checkbox disconnects it. The URL
   * is a bearer token for somebody's whole calendar, so the card never renders
   * it back — which means a blank field cannot mean "clear it", or saving a
   * corrected spelling of a name would silently re-offer every hour that
   * person is already busy.
   */
  const feed = String(formData.get("calendarFeedUrl") ?? "").trim();
  const calendarFeedUrl =
    formData.get("calendarFeedRemove") === "on" ? null : feed || undefined;

  const zone = String(formData.get("timeZone") ?? "").trim();

  const result = await saveStaff(shop.id, {
    id,
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    hours,
    // An empty select is "the shop's zone", which is why this is not
    // `readTimeZone(…, shop.timeZone)`: that helper falls back to the shop's
    // *value*, and storing it would freeze the person's zone against a later
    // change to the shop's.
    timeZone: zone ? readTimeZone(zone, shop.timeZone) : null,
    calendarFeedUrl,
    isActive: formData.get("isActive") === "on",
  });

  if (!result.ok) return { ok: false, error: sentenceFor(result.refusal) };

  revalidatePath("/admin/settings/staff");
  return { ok: true, message: result.created ? "Added." : "Saved." };
}

/**
 * Taking somebody off the rota, or putting them back.
 *
 * Not a delete, and the button says "Taking bookings" rather than "Remove" for
 * the reason the column exists: every appointment they have ever taken points
 * at this row, so removing it would detach the history and a seller looking at
 * last month would see who did the work turn into nobody.
 */
export async function toggleStaffActive(formData: FormData) {
  const { shop } = await requireShop("settings:write");

  const staffId = String(formData.get("staffId") ?? "").trim();
  if (!staffId) return;

  /*
   * Deactivating is allowed on any plan, and only reactivating is gated. A
   * shop that downgrades must be able to stop offering somebody — the
   * alternative is a seller who cannot turn off a calendar they are no longer
   * paying for, which is a bill for a feature and a trap in one.
   */
  const active = formData.get("active") === "on";
  if (active && !can(shop, "staffResources")) return;

  await setStaffActive(shop.id, staffId, active);
  revalidatePath("/admin/settings/staff");
}
