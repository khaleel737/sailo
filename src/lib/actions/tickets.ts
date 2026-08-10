"use server";

import { checkInTicketForShop, type CheckInState } from "@/lib/tickets";
import { requireShop } from "@/lib/session";

/** The door, behind the seller's own session. All decisions live in the lib. */
export async function checkInTicket(
  _prev: CheckInState,
  formData: FormData,
): Promise<CheckInState> {
  const { shop } = await requireShop();
  return checkInTicketForShop(shop.id, String(formData.get("code") ?? ""));
}
