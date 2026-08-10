"use server";

import { after } from "next/server";
import { checkInTicketForShop, type CheckInState } from "@/lib/tickets";
import { publishShopEvent } from "@/lib/events";
import { requireShop } from "@/lib/session";

/** The door, behind the seller's own session. All decisions live in the lib. */
export async function checkInTicket(
  _prev: CheckInState,
  formData: FormData,
): Promise<CheckInState> {
  const { shop } = await requireShop();
  const result = await checkInTicketForShop(
    shop.id,
    String(formData.get("code") ?? ""),
  );
  // Check-in usually happens on a phone at the door while the orders screen
  // is open somewhere else; that screen should see the ticket turn used.
  if (result.status === "checked_in") {
    after(() => publishShopEvent(shop.id, "booking"));
  }
  return result;
}
