"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  apiKeys,
  session as sessionTable,
  shops,
  staffActions,
  supportTickets,
  twoFactor,
  user as userTable,
  type Shop,
} from "@sailo/db/schema";
import { parseUserAgent } from "@/lib/analytics";
import { sendTwoFactorChanged } from "@/lib/email";
import { publishShopEvent } from "@sailo/events";
import { maybeRow } from "@sailo/core/invariant";
import { requireStaff } from "@/lib/session";
import { updateShopNow } from "@/lib/cache";
import { isPlanId, PLANS } from "@sailo/core/plans";
import type { ActionState } from "./shop";

/* ===========================================================================
   What staff may do to someone else's account.

   Everything else in /hq is read-only, and that is the intended balance: this
   panel exists to understand the business, not to operate sellers' shops for
   them. What is here is what support genuinely needs — grant a plan, take an
   abusive shop down, get an account back from whoever has taken it — and every
   one of them writes a row to `staff_actions` before it returns.

   The split below is deliberate. The first group acts on a *shop*: entitlements
   and visibility, which change what the public storefront renders, so each one
   busts the storefront cache on its way out. The second acts on a *person*:
   sessions, second factors, credentials. Those exist because the alternative to
   staff being able to sign a stolen account out is telling its owner to wait.
=========================================================================== */

async function loadShop(formData: FormData) {
  const staff = await requireStaff();

  const shopId = String(formData.get("shopId") ?? "").trim();
  if (!shopId) return { staff, shop: null } as const;

  const shop = await getDb().query.shops.findFirst({
    where: eq(shops.id, shopId),
  });
  return { staff, shop: shop ?? null } as const;
}

async function record(
  actorEmail: string,
  action: string,
  shop: Shop,
  summary: string,
) {
  await getDb().insert(staffActions).values({
    actorEmail,
    action,
    shopId: shop.id,
    summary,
  });

  /*
   * Entitlements and visibility both change what the public storefront
   * renders, and the storefront is cached until a write says otherwise. Busting
   * the tag here rather than in each caller means no staff action can ship a
   * change that only takes effect the next time the seller happens to edit
   * something.
   *
   * `updateShopNow` rather than the seller-side `revalidateShop`: a staff
   * action is enforcement, and enforcement that lets one more request through
   * isn't enforcement.
   */
  updateShopNow(shop.id, shop.handle);
  revalidatePath(`/hq/accounts/${shop.userId}`);
  revalidatePath("/hq/accounts");
  revalidatePath("/hq/revenue");
  revalidatePath("/hq");

  /*
   * Enforcement lands on the seller's screen as it lands on their account: a
   * suspension banner, a granted plan, a staff note. The seller's panel is
   * the audience the paths above can't reach, being another user's session.
   */
  after(() => publishShopEvent(shop.id, "account"));
}

/**
 * Grants a plan we aren't charging for, or takes one back.
 *
 * Written to `compPlan`, never to `plan` — see the column's note. The seller
 * sees the features; they don't see a bill, because there isn't one.
 */
export async function setCompPlan(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { staff, shop } = await loadShop(formData);
  if (!shop) return { ok: false, error: "That account no longer exists." };

  const requested = String(formData.get("plan") ?? "none").trim();
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);

  if (requested === "none") {
    if (!shop.compPlan) {
      return { ok: false, error: "This account isn't comped." };
    }
    const previous = shop.compPlan;
    await getDb()
      .update(shops)
      .set({ compPlan: null, compNote: null, updatedAt: new Date() })
      .where(eq(shops.id, shop.id));

    await record(
      staff.email,
      "clear_comp",
      shop,
      `Removed the comped ${previous} plan — back to whatever Stripe says.`,
    );
    return { ok: true, message: "Comp removed." };
  }

  if (!isPlanId(requested) || requested === "free") {
    return { ok: false, error: "Pick a paid plan, or None to remove the comp." };
  }

  await getDb()
    .update(shops)
    .set({ compPlan: requested, compNote: note || null, updatedAt: new Date() })
    .where(eq(shops.id, shop.id));

  await record(
    staff.email,
    "comp_plan",
    shop,
    `Comped ${PLANS[requested].name}${note ? ` — ${note}` : ""}.`,
  );
  return { ok: true, message: `${PLANS[requested].name} granted.` };
}

/**
 * Takes a shop off the air, or puts it back.
 *
 * Separate from the seller's own publish switch: they can turn that one back
 * on, and someone we suspended for fraud absolutely would.
 */
export async function setSuspended(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { staff, shop } = await loadShop(formData);
  if (!shop) return { ok: false, error: "That account no longer exists." };

  const suspend = String(formData.get("suspend") ?? "") === "1";
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);

  if (suspend) {
    if (!reason) {
      return {
        ok: false,
        error: "Say why. Whoever reads this in six months won't remember.",
      };
    }
    await getDb()
      .update(shops)
      .set({
        suspendedAt: new Date(),
        suspendedReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(shops.id, shop.id));

    await record(staff.email, "suspend", shop, `Suspended — ${reason}`);
    return { ok: true, message: "Shop suspended. It is offline now." };
  }

  await getDb()
    .update(shops)
    .set({ suspendedAt: null, suspendedReason: null, updatedAt: new Date() })
    .where(eq(shops.id, shop.id));

  await record(staff.email, "unsuspend", shop, "Suspension lifted.");
  return { ok: true, message: "Shop is back online." };
}

/**
 * Stops this shop's marketing email, or lets it start again.
 *
 * Narrower than a suspension on purpose, and the two must not be confused. A
 * suspension takes the storefront down; this leaves the shop trading, selling
 * and sending receipts, and stops only the broadcasts. It is normally written
 * by `lib/broadcasts/reputation.ts` when a shop's bounce or complaint rate
 * crosses a threshold — this is the human end of that: the way it comes off,
 * and the way it goes on for a shop we have decided about before the numbers
 * have.
 *
 * Lifting it does not forgive the numbers. The rolling window is still what it
 * is, so the next bounce or complaint re-evaluates and can pause the shop
 * again within the minute. That is the intended behaviour — the pause is a
 * measurement, not a punishment to be served — and it is why lifting one
 * without fixing the list is not a way to get a bad send out.
 */
export async function setMarketingPaused(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { staff, shop } = await loadShop(formData);
  if (!shop) return { ok: false, error: "That account no longer exists." };

  const pause = String(formData.get("pause") ?? "") === "1";
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);

  if (pause) {
    if (!reason) {
      return {
        ok: false,
        error: "Say why. Whoever reads this in six months won't remember.",
      };
    }
    await getDb()
      .update(shops)
      .set({
        marketingPausedAt: new Date(),
        marketingPausedReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(shops.id, shop.id));

    await record(staff.email, "marketing_pause", shop, `Marketing paused — ${reason}`);
    return { ok: true, message: "Marketing sending stopped for this shop." };
  }

  await getDb()
    .update(shops)
    .set({
      marketingPausedAt: null,
      marketingPausedReason: null,
      updatedAt: new Date(),
    })
    .where(eq(shops.id, shop.id));

  await record(staff.email, "marketing_resume", shop, "Marketing pause lifted.");
  return { ok: true, message: "They can send marketing again." };
}

/** An internal note on the account. Never rendered anywhere a seller can see. */
export async function saveStaffNote(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { staff, shop } = await loadShop(formData);
  if (!shop) return { ok: false, error: "That account no longer exists." };

  const note = String(formData.get("note") ?? "").trim().slice(0, 2000);

  await getDb()
    .update(shops)
    .set({ staffNote: note || null, updatedAt: new Date() })
    .where(eq(shops.id, shop.id));

  await record(
    staff.email,
    "note",
    shop,
    note ? `Note: ${note.slice(0, 120)}` : "Cleared the note.",
  );
  return { ok: true, message: "Saved." };
}

/* ===========================================================================
   Account security

   The seller can do all of this to themselves in Settings → Security, and
   normally should. These exist for the two cases where they can't: the account
   is not theirs any more, or the authenticator went into the sea with the phone.

   Three rules hold across every action here.

   1. No credential is read, written or returned. Sessions are revoked by
      deleting rows, a second factor by deleting the enrolment — never by
      selecting a secret and comparing it. The `id` in the form is a row id.
   2. The owner is told. A silent change to who can get into an account is
      indistinguishable from the attack; ours arrive by email.
   3. It lands in `staff_actions` with a reason, before the function returns.
=========================================================================== */

/**
 * The audit row for an action about a *person* rather than their shop.
 *
 * `record()` above also busts the storefront cache and pings the seller's
 * panel, because entitlements and suspensions change what the public page
 * renders. Signing a device out changes nothing a visitor can see, so this
 * writes the row and refreshes the two staff screens that show it — and
 * nothing else.
 */
async function recordOnAccount(
  actorEmail: string,
  action: string,
  shopId: string | null,
  ownerId: string,
  summary: string,
) {
  await getDb().insert(staffActions).values({
    actorEmail,
    action,
    shopId,
    summary,
  });

  revalidatePath(`/hq/accounts/${ownerId}`);
  revalidatePath("/hq/security");
}

/** The account an action names, with the shop it owns if there is one. */
async function loadAccount(formData: FormData) {
  const staff = await requireStaff();
  const db = getDb();

  const userId = String(formData.get("userId") ?? "").trim();
  if (!userId) return { staff, owner: null, shopId: null } as const;

  const owner = await db.query.user.findFirst({
    where: eq(userTable.id, userId),
    columns: { id: true, name: true, email: true, twoFactorEnabled: true },
  });
  if (!owner) return { staff, owner: null, shopId: null } as const;

  const shop = await db.query.shops.findFirst({
    where: eq(shops.userId, owner.id),
    columns: { id: true },
  });

  return { staff, owner, shopId: shop?.id ?? null } as const;
}

/**
 * Signs one device out.
 *
 * The row id, never the token — a bearer credential that reaches the page is a
 * bearer credential in the page's HTML, and this page lists every seller's.
 * Deleting the row *is* the revocation: `lib/auth.ts` deliberately runs without
 * a session cookie cache, so the next request carrying that cookie fails its
 * lookup rather than living out a cached TTL.
 */
export async function revokeAccountSession(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff();

  const id = String(formData.get("sessionId") ?? "").trim();
  if (!id) return { ok: false, error: "That session no longer exists." };

  const db = getDb();
  const row = await db.query.session.findFirst({
    where: eq(sessionTable.id, id),
    columns: { id: true, userId: true, userAgent: true, city: true, country: true },
  });
  if (!row) return { ok: false, error: "That session no longer exists." };

  const shop = await db.query.shops.findFirst({
    where: eq(shops.userId, row.userId),
    columns: { id: true },
  });

  await db.delete(sessionTable).where(eq(sessionTable.id, row.id));

  // Named in the audit trail, because "signed a device out" a month later is
  // not an answer to "which one, and was it the intruder's?".
  const { browser, os } = parseUserAgent(row.userAgent);
  const where = [row.city, row.country].filter(Boolean).join(", ");
  const device = [browser, os].filter(Boolean).join(" on ") || "an unrecognised device";

  await recordOnAccount(
    staff.email,
    "revoke_session",
    shop?.id ?? null,
    row.userId,
    `Signed out ${device}${where ? ` in ${where}` : ""}.`,
  );

  return { ok: true, message: "Signed out." };
}

/**
 * Signs every device out at once.
 *
 * The first thing to do about a compromised account, and the reason it is one
 * button: whoever is in there stays in until the rows are gone, and asking the
 * owner to click through their own settings assumes they can still sign in.
 */
export async function revokeAccountSessions(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { staff, owner, shopId } = await loadAccount(formData);
  if (!owner) return { ok: false, error: "That account no longer exists." };

  /*
   * Our own session lives in this table too, and the button would work — it
   * would sign us out of the panel we are standing in, mid-action, and leave
   * the seller's problem untouched. Settings → Security is where that belongs.
   */
  if (owner.id === staff.id) {
    return {
      ok: false,
      error: "That's your own account — use Settings → Security.",
    };
  }

  const killed = await getDb()
    .delete(sessionTable)
    .where(eq(sessionTable.userId, owner.id))
    .returning({ id: sessionTable.id });

  if (killed.length === 0) {
    return { ok: false, error: "Nothing to do — nobody is signed in." };
  }

  await recordOnAccount(
    staff.email,
    "revoke_sessions",
    shopId,
    owner.id,
    `Signed out all ${killed.length} signed-in ${killed.length === 1 ? "device" : "devices"}.`,
  );

  return {
    ok: true,
    message: `${killed.length} ${killed.length === 1 ? "device" : "devices"} signed out.`,
  };
}

/**
 * Removes a second factor the owner can no longer produce.
 *
 * A lost authenticator with the backup codes lost alongside it is a locked
 * account with no self-serve way out, and the only alternative to this button
 * is deleting the account and its shop with it.
 *
 * It is written straight to the tables on purpose. Better-auth's
 * `disableTwoFactor` demands the account's own password and its own session,
 * which is exactly right for the seller and impossible for us — we have
 * neither, and should never be able to obtain either. So the enrolment row goes,
 * the flag goes with it, and the three things that make this safe to do at all
 * happen in the same breath: every session is revoked so the change cannot be
 * used by whoever was already inside, the owner is emailed, and the reason is
 * written down under the name of whoever typed it.
 */
export async function clearAccountTwoFactor(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { staff, owner, shopId } = await loadAccount(formData);
  if (!owner) return { ok: false, error: "That account no longer exists." };

  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  if (!reason) {
    return {
      ok: false,
      error: "Say why, and say how you know who you were talking to.",
    };
  }

  const db = getDb();
  const enrolled = await db.query.twoFactor.findFirst({
    where: eq(twoFactor.userId, owner.id),
    columns: { id: true },
  });

  if (!enrolled && !owner.twoFactorEnabled) {
    return { ok: false, error: "This account has no second factor to clear." };
  }

  /*
   * Both, always. The flag is what the sign-in flow checks and the row is what
   * holds the secret; clearing one and not the other leaves an account that
   * either can't sign in or is guarded by a secret nobody has.
   */
  await db.delete(twoFactor).where(eq(twoFactor.userId, owner.id));
  await db
    .update(userTable)
    .set({ twoFactorEnabled: false, updatedAt: new Date() })
    .where(eq(userTable.id, owner.id));

  const killed = await db
    .delete(sessionTable)
    .where(eq(sessionTable.userId, owner.id))
    .returning({ id: sessionTable.id });

  await recordOnAccount(
    staff.email,
    "clear_two_factor",
    shopId,
    owner.id,
    `Cleared two-factor and signed out ${killed.length} ${killed.length === 1 ? "device" : "devices"} — ${reason}`,
  );

  /*
   * After the write, and not awaited into the result: the account is already
   * unlocked, and a Resend outage must not make it look as though it isn't.
   * The failure is logged, exactly as `announceTwoFactorChange` logs its own.
   */
  after(async () => {
    const result = await sendTwoFactorChanged({
      to: owner.email,
      name: owner.name,
      enabled: false,
    });
    if (!result.sent) {
      console.warn(`[sailo] staff 2FA clear email not sent: ${result.reason}`);
    }
  });

  return {
    ok: true,
    message: "Two-factor cleared. They can sign in with their password and enrol again.",
  };
}

/**
 * Revokes an API key on the seller's behalf.
 *
 * The key opens `/api/v1` and `/api/mcp` for their shop, so a leaked one is a
 * live hole until somebody stamps it — and the person best placed to notice a
 * key pasted into a public repository is us, not them. A stamp rather than a
 * delete, for the reason the column's own note gives: a deleted key can't
 * answer "what was that, and when did we turn it off".
 */
export async function revokeAccountApiKey(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const staff = await requireStaff();

  const id = String(formData.get("keyId") ?? "").trim();
  if (!id) return { ok: false, error: "That key no longer exists." };

  const db = getDb();
  const key = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.id, id),
    columns: { id: true, label: true, prefix: true, shopId: true, revokedAt: true },
  });
  if (!key) return { ok: false, error: "That key no longer exists." };
  if (key.revokedAt) return { ok: false, error: "That key is already revoked." };

  const shop = await db.query.shops.findFirst({
    where: eq(shops.id, key.shopId),
    columns: { userId: true },
  });

  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, key.id), eq(apiKeys.shopId, key.shopId)));

  if (shop) {
    await recordOnAccount(
      staff.email,
      "revoke_api_key",
      key.shopId,
      shop.userId,
      `Revoked the API key "${key.label.slice(0, 60)}" (${key.prefix}).`,
    );
  }

  // The seller's own integrations page lists it, and it needs to stop saying
  // the key is live the moment it isn't.
  revalidatePath("/admin/settings/integrations");
  return { ok: true, message: "Key revoked. Anything using it stops now." };
}

/**
 * Marks a support ticket answered. The conversation itself lives in email —
 * this is the queue's bookkeeping, so the list shows what still needs a reply.
 */
export async function closeSupportTicket(formData: FormData) {
  const staff = await requireStaff();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const db = getDb();
  // Guarded on status, so two staff closing the same ticket audit it once.
  const closed = maybeRow(
    await db
      .update(supportTickets)
      .set({ status: "closed", closedAt: new Date() })
      .where(and(eq(supportTickets.id, id), eq(supportTickets.status, "open")))
      .returning(),
  );
  if (!closed) return;

  /*
   * The audit row directly rather than through `record()`: closing a ticket
   * is desk housekeeping, and `record` also busts the shop's storefront
   * cache — enforcement plumbing a ticket doesn't touch.
   */
  await db.insert(staffActions).values({
    actorEmail: staff.email,
    action: "support_close",
    shopId: closed.shopId,
    summary: `Closed support ticket "${closed.subject.slice(0, 120)}".`,
  });

  revalidatePath("/hq/support");
  // The seller's own list shows the status too.
  revalidatePath("/admin/support");
  after(() => publishShopEvent(closed.shopId, "support"));
}
