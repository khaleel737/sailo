"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { CheckInState } from "@sailo/commerce/ticketing";
import {
  addWalkUp as addWalkUpAtDoor,
  admitByCode as admitCodeAtDoor,
  admitByTicket as admitTicketAtDoor,
  revokeAdmission as revokeAtDoor,
  undoAdmission as undoAtDoor,
  type Door,
} from "@sailo/commerce/ticketing";
import { createDoorPass, readDoorPass, revokeDoorPass } from "@/lib/door-pass";
import {
  eventDoorList,
  eventDoorStats,
  isDoorFilter,
  type DoorFilter,
  type DoorRow,
  type DoorStats,
} from "@sailo/commerce/ticketing";
import { requireShop } from "@/lib/session";

/**
 * Who is asking, and what they are allowed to touch.
 *
 * All that is left in this app. What happens *after* the question is answered
 * — the claim, the announcement, the pass's own usage counter — moved to
 * `@sailo/commerce/door`, because the mobile app scans tickets too and a
 * second copy of the admission cascade is a second chance to forget the half
 * that is silent. A guest admitted from a phone has to move the same counters
 * as one admitted from a laptop, on every other volunteer's screen.
 *
 * This half could not go with it. A session is `next/headers`, a door pass is
 * a token in *this app's* URL, and `@sailo/api` has neither — it has
 * `ctx.shopId` and builds its own `Door` from that.
 */

type DoorInput = {
  /** Present when the caller is a volunteer on `/door/[token]`. */
  token?: string | null;
  /** The event the screen is scoped to. Ignored when a pass names one. */
  productId?: string | null;
};

/**
 * The scope resolution is the security boundary and is deliberately not
 * symmetric: a pass issued for one event ignores whatever `productId` the
 * client sends, because the client is a page a volunteer is holding and the
 * pass is the only thing here we trust. For a shop-wide pass, and for an
 * owner, the screen's scope is a convenience rather than a permission.
 */
async function doorFor(input: DoorInput): Promise<Door | null> {
  const token = input.token?.trim();

  if (token) {
    const session = await readDoorPass(token);
    if (!session) return null;
    return {
      shopId: session.pass.shopId,
      productId: session.pass.productId ?? input.productId ?? null,
      by: session.pass.name,
      passId: session.pass.id,
    };
  }

  const { shop } = await requireShop();
  return {
    shopId: shop.id,
    productId: input.productId ?? null,
    by: null,
    passId: null,
  };
}

/** Owner-only. Anything a volunteer must not reach goes through this. */
async function ownerShopId(): Promise<string> {
  const { shop } = await requireShop();
  return shop.id;
}

const REFUSED: CheckInState = { status: "not_found", code: "" };

/**
 * Handed to every call below. `after` is what keeps the volunteer's tap off
 * the publish and the pass counter; `@sailo/api` has no scheduler and awaits
 * instead.
 */
const HOOKS = { defer: after };

/* -------------------------------------------------------------------------- */
/*  Admitting                                                                  */
/* -------------------------------------------------------------------------- */

export async function admitByCode(
  input: DoorInput & { code: string },
): Promise<CheckInState> {
  const door = await doorFor(input);
  if (!door) return REFUSED;
  return admitCodeAtDoor(door, input.code, HOOKS);
}

/** Admitting from the guest list, for somebody whose phone is dead. */
export async function admitByTicket(
  input: DoorInput & { ticketId: string },
): Promise<CheckInState> {
  const door = await doorFor(input);
  if (!door) return REFUSED;
  return admitTicketAtDoor(door, input.ticketId, HOOKS);
}

export async function undoAdmission(
  input: DoorInput & { ticketId: string },
): Promise<{ ok: boolean }> {
  const door = await doorFor(input);
  if (!door) return { ok: false };
  return undoAtDoor(door, input.ticketId, HOOKS);
}

/**
 * Revoking, which a volunteer may not do.
 *
 * Undo fixes a mis-scan and is safe in anyone's hands — the worst it can do
 * is let a ticket admit again. Revoking takes an admission away for good,
 * which is a decision about somebody's money, and it belongs to whoever owns
 * the shop. `ownerShopId`, not `doorFor`: a token must not reach this at all.
 */
export async function revokeAdmission(input: {
  ticketId: string;
  revoked: boolean;
}): Promise<{ ok: boolean }> {
  const shopId = await ownerShopId();
  return revokeAtDoor(shopId, input.ticketId, input.revoked, HOOKS);
}

/**
 * Somebody who turned up without a ticket and is being let in anyway.
 *
 * Minted and admitted in one step, because that is what is happening: the
 * volunteer is not selling a ticket, they are writing down that a person came
 * in. Recorded as `manual`, so the attendance count and the revenue count
 * never quietly become the same number.
 */
export async function addWalkUp(
  input: DoorInput & {
    name: string;
    email?: string | null;
    tier?: string | null;
  },
): Promise<CheckInState> {
  const door = await doorFor(input);
  if (!door) return REFUSED;
  return addWalkUpAtDoor(
    door,
    { name: input.name, email: input.email, tier: input.tier },
    HOOKS,
  );
}

/* -------------------------------------------------------------------------- */
/*  Reading                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The guest list, re-read as the volunteer types.
 *
 * A server action rather than a navigation: this is somebody holding a phone
 * in a queue, and a full page render per keystroke is a list that arrives
 * after the guest has walked off.
 */
export async function searchDoor(
  input: DoorInput & {
    search?: string;
    status?: string;
    tier?: string | null;
    offset?: number;
  },
): Promise<{ rows: DoorRow[]; total: number }> {
  const door = await doorFor(input);
  if (!door?.productId) return { rows: [], total: 0 };

  const status: DoorFilter =
    input.status && isDoorFilter(input.status) ? input.status : "all";

  return eventDoorList(
    door.shopId,
    door.productId,
    { search: input.search ?? "", status, tier: input.tier ?? null },
    100,
    Math.max(0, input.offset ?? 0),
  );
}

/** The counters over the door, re-read after every admission. */
export async function doorStats(input: DoorInput): Promise<DoorStats | null> {
  const door = await doorFor(input);
  if (!door?.productId) return null;
  return eventDoorStats(door.shopId, door.productId);
}

/* -------------------------------------------------------------------------- */
/*  Passes — owner only, always                                                */
/* -------------------------------------------------------------------------- */

export type PassFormState = { ok: boolean; error?: string };

export async function issueDoorPass(
  _prev: PassFormState,
  formData: FormData,
): Promise<PassFormState> {
  const shopId = await ownerShopId();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Give the pass a name." };

  const productId = String(formData.get("productId") ?? "") || null;
  const hours = Number.parseInt(String(formData.get("hours") ?? "12"), 10);

  await createDoorPass({
    shopId,
    productId,
    name,
    /*
     * Expiring by default, and the form offers nothing longer than a week.
     * A door pass is a bearer credential shown to strangers on a phone
     * screen; the failure mode of a permanent one is that it is still
     * admitting people to a venue eight months after the volunteer who held
     * it stopped helping out, and nobody remembers it exists.
     */
    expiresAt: Number.isFinite(hours)
      ? new Date(Date.now() + Math.min(Math.max(hours, 1), 168) * 3600 * 1000)
      : null,
  });

  revalidatePath("/admin/checkin", "layout");
  return { ok: true };
}

export async function revokePass(formData: FormData): Promise<void> {
  const shopId = await ownerShopId();
  const id = String(formData.get("id") ?? "");
  if (id) await revokeDoorPass(shopId, id);
  revalidatePath("/admin/checkin", "layout");
}
