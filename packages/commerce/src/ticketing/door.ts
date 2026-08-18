import "server-only";
import { publishShopEvent } from "@sailo/events";
import { touchDoorPass } from "./door-pass";
import { onceWithin, type IdempotentOutcome } from "../orders/idempotency";
import {
  checkInTicketById,
  checkInTicketForShop,
  issueTickets,
  setTicketRevoked,
  undoCheckIn,
  type CheckInState,
} from "./tickets";
import {
  checkInMemberByCode,
  type MemberCheckInState,
} from "../memberships/passes";

/**
 * The door, from either side of the credential.
 *
 * A shop owner reaches these through their own session; a volunteer reaches
 * them through a door-pass token in a URL; and now a seller reaches them
 * through the mobile app. All three arrive as a `Door` below, and nothing here
 * knows or cares which — which is the point, and was the point before the phone
 * existed: the scanner, the guest list and the undo button are one
 * implementation, so a volunteer gets exactly the tool the owner has and
 * nothing else.
 *
 * What each caller keeps is deciding *who is asking*. That is a session in
 * apps/web, a token on `/door/[token]`, and `ctx.shopId` in `@sailo/api`, and
 * none of the three is portable. What none of them keeps is deciding what
 * happens next.
 */

export type Door = {
  shopId: string;
  /** The event this caller may work, or null for an unscoped owner. */
  productId: string | null;
  /** Recorded on every row this door admits. Null is the owner in person. */
  by: string | null;
  passId: string | null;
};

/**
 * Where a caller's scheduler plugs in, exactly as `changeOrderStatus`'s does.
 *
 * Next call sites pass `after`; `apps/api` has no request scope and passes
 * nothing, so the announcement is awaited instead. Awaiting is slower and
 * correct; dropping it would leave two other volunteers' screens showing a
 * queue that has already walked in.
 */
export type DoorHooks = {
  defer?: (task: () => Promise<void>) => void;
};

/**
 * Announces a change so every other door screen sees it, and marks the pass
 * as having been used.
 *
 * Three volunteers on three phones is the case this exists for: one admits
 * somebody and the other two counters have to move, or the second volunteer
 * lets the same person in again while their screen still shows them outside.
 */
async function announce(door: Door, admitted: boolean, hooks: DoorHooks) {
  const task = async () => {
    await publishShopEvent(door.shopId, "booking");
    if (door.passId) await touchDoorPass(door.passId, admitted);
  };
  if (hooks.defer) hooks.defer(task);
  else await task();
}

/* -------------------------------------------------------------------------- */
/*  Admitting                                                                  */
/* -------------------------------------------------------------------------- */

export async function admitByCode(
  door: Door,
  code: string,
  hooks: DoorHooks = {},
): Promise<CheckInState> {
  const result = await checkInTicketForShop(door.shopId, code, {
    productId: door.productId,
    by: door.by,
  });

  await announce(door, result.status === "checked_in", hooks);
  return result;
}

/**
 * The same door, for somebody holding a membership instead of a ticket.
 *
 * A separate entry point rather than a branch inside `admitByCode`, because
 * the two answers are genuinely different shapes and flattening them would
 * cost the caller the thing it most needs to say: a ticket scanned twice is a
 * refusal and a member scanned twice is not. `admitAnyCode` below is where
 * they meet, for the one caller that does not know in advance which it has.
 */
export async function admitMemberByCode(
  door: Door,
  code: string,
  hooks: DoorHooks = {},
): Promise<MemberCheckInState> {
  const result = await checkInMemberByCode(door.shopId, code, {
    productId: door.productId,
    by: door.by,
  });

  await announce(
    door,
    result.status === "checked_in" || result.status === "already_in",
    hooks,
  );
  return result;
}

/**
 * One scan, whichever credential it turns out to be.
 *
 * This is what the scanner actually calls. A doorperson holds one phone and
 * points it at whatever a person presents; asking them to first decide
 * *which kind of thing* they are about to scan is asking them to do the
 * lookup we are about to do anyway.
 *
 * Tickets are tried first and member passes only when the ticket lookup finds
 * nothing at all. That ordering is free of ambiguity rather than merely
 * lucky: the two codes are different lengths after folding — ten against
 * twelve — so a string cannot be a candidate for both, and `not_found` from
 * the first is the only case that reaches the second. Any other ticket
 * answer (`already_used`, `revoked`, `wrong_event`) means a real ticket was
 * found and must be reported as itself, never retried as a membership.
 */
export type DoorVerdict =
  | { kind: "ticket"; result: CheckInState }
  | { kind: "member"; result: MemberCheckInState };

export async function admitAnyCode(
  door: Door,
  code: string,
  hooks: DoorHooks = {},
): Promise<DoorVerdict> {
  const ticket = await admitByCode(door, code, hooks);
  if (ticket.status !== "not_found") return { kind: "ticket", result: ticket };

  const member = await admitMemberByCode(door, code, hooks);
  /*
   * Neither matched. The ticket answer is the one to show: it is the
   * credential the overwhelming majority of doors are checking, and
   * "no such ticket" is a sentence a volunteer already understands.
   */
  if (member.status === "not_found") return { kind: "ticket", result: ticket };
  return { kind: "member", result: member };
}

/** Admitting from the guest list, for somebody whose phone is dead. */
export async function admitByTicket(
  door: Door,
  ticketId: string,
  hooks: DoorHooks = {},
): Promise<CheckInState> {
  const result = await checkInTicketById(door.shopId, ticketId, {
    productId: door.productId,
    by: door.by,
  });

  await announce(door, result.status === "checked_in", hooks);
  return result;
}

export async function undoAdmission(
  door: Door,
  ticketId: string,
  hooks: DoorHooks = {},
): Promise<{ ok: boolean }> {
  const ok = await undoCheckIn(door.shopId, ticketId);
  if (ok) await announce(door, false, hooks);
  return { ok };
}

/**
 * Revoking, which a volunteer may not do.
 *
 * Undo fixes a mis-scan and is safe in anyone's hands — the worst it can do
 * is let a ticket admit again. Revoking takes an admission away for good,
 * which is a decision about somebody's money, and it belongs to whoever owns
 * the shop. Takes a shop id rather than a `Door` for exactly that reason:
 * there is no pass that reaches this, so there is no pass to pass in.
 */
export async function revokeAdmission(
  shopId: string,
  ticketId: string,
  revoked: boolean,
  hooks: DoorHooks = {},
): Promise<{ ok: boolean }> {
  const ok = await setTicketRevoked(shopId, ticketId, revoked);
  if (ok) {
    await announce({ shopId, productId: null, by: null, passId: null }, false, hooks);
  }
  return { ok };
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
  door: Door,
  attendee: { name: string; email?: string | null; tier?: string | null },
  hooks: DoorHooks = {},
): Promise<CheckInState> {
  const refused: CheckInState = { status: "not_found", code: "" };
  if (!door.productId) return refused;

  const name = attendee.name.trim().slice(0, 120);
  if (!name) return refused;

  const [ticket] = await issueTickets(door.shopId, [
    {
      productId: door.productId,
      attendeeName: name,
      attendeeEmail: attendee.email?.trim().toLowerCase().slice(0, 200) || null,
      tier: attendee.tier?.trim().slice(0, 80) || null,
      source: "manual",
    },
  ]);
  if (!ticket) return refused;

  const result = await checkInTicketById(door.shopId, ticket.id, {
    productId: door.productId,
    by: door.by,
  });

  await announce(door, result.status === "checked_in", hooks);
  return result;
}

/* -------------------------------------------------------------------------- */
/*  Admitting twice                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The same scan, replayed, answering what it answered the first time.
 *
 * A10 builds a scanner that queues admissions while the venue's wifi is down
 * and replays them on reconnect — and a replay is indistinguishable, from
 * here, from a volunteer scanning the same wristband twice. Both are safe
 * already: `claim()` is a conditional UPDATE on `status = 'valid'`, so the
 * second one never admits anybody. What is *not* safe is the answer. The
 * replay comes back `already_used`, the scanner shows a red screen, and the
 * volunteer standing in front of a guest who was in fact admitted has to
 * decide whether to believe it.
 *
 * So the key buys the answer, not the safety. The safety is in the WHERE and
 * stays there — which is why this degrades honestly: when Redis is not
 * configured or is cold, `withRedis` falls back, the admit runs, and the worst
 * case is the red screen we had before. Nobody is admitted twice at any point,
 * with or without a cache. See `./idempotency`.
 */
export async function admitOnce(
  door: Door,
  input: { code: string; idempotencyKey: string },
  hooks: DoorHooks = {},
): Promise<IdempotentOutcome<CheckInState>> {
  return onceWithin(
    // Namespaced by shop, so one seller's key can never return another
    // seller's admission — a client picks these, and clients collide.
    `admit:${door.shopId}:${input.idempotencyKey}`,
    () => admitByCode(door, input.code, hooks),
    // Only an actual admission is worth replaying. A `not_found` cached for a
    // day would keep answering "no such ticket" about a code the seller has
    // since fixed, which is a worse answer than simply asking again.
    (result) => result.status === "checked_in",
  );
}
