"use server";

/**
 * Taking access away from an account, on the account's behalf.
 *
 * Revoking a session, revoking all of them, clearing a second factor, revoking an API key.
 * Grouped because they are the same act with different scopes and the same risk: each one is
 * HQ reaching into somebody else's account, so each writes a staff note naming who did it.
 *
 * Split out of a 613-line `actions/hq.ts` that also set plans and suspended shops. A file where
 * "give this shop a comped plan" sits next to "clear this account's 2FA" is a file where the
 * blast radius of an edit is not obvious from its name.
 */

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { apiKeys, session as sessionTable, shops, twoFactor, user as userTable } from "@sailo/db/schema";
import { parseUserAgent } from "@sailo/analytics/traffic";
import { sendTwoFactorChanged } from "@/lib/email";
import { requireStaff } from "@/lib/session";
import type { ActionState } from "../shop";
import { recordOnAccount, loadAccount } from "./shared";


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
