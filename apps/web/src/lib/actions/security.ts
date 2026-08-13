"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, desc, eq, ne } from "drizzle-orm";
import { toDataURL } from "qrcode";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getDb } from "@sailo/db";
import { session as sessionTable, user as userTable } from "@sailo/db/schema";
import { rateLimit } from "@sailo/rate-limit";
import { sendTwoFactorChanged } from "@/lib/email";

/**
 * Settings → Security: two-factor enrolment and the login-sessions table.
 *
 * Everything here rides better-auth's own endpoints (`auth.api.*`) for the
 * cryptography — secrets, codes and their comparisons are the plugin's job,
 * never hand-rolled — and adds the two things the plugin doesn't do: revoking
 * every *other* session when 2FA changes, and telling the account by email.
 * A silent 2FA change is what an account thief does; ours are loud.
 */

export type SecurityActionState = {
  ok: boolean;
  error?: string;
  /** Enrolment step one: what the authenticator needs. */
  totpUri?: string;
  qrDataUrl?: string;
  /** Shown exactly once — stored encrypted, never displayed again. */
  backupCodes?: string[];
};

/**
 * Better-auth's refusals are English sentences meant for developers; the ones
 * a seller can actually cause are mapped to something calmer. Anything
 * unmapped falls through verbatim rather than as "something went wrong" —
 * a rate-limit message must survive, or a throttled attempt reads as *wrong*
 * (see the repo rule: throttled is unknown, never invalid).
 */
function refusalMessage(error: unknown): string {
  if (error instanceof APIError) {
    const code = (error.body as { code?: string } | undefined)?.code;
    if (code === "INVALID_PASSWORD") return "That password isn't right.";
    if (code === "INVALID_CODE" || code === "INVALID_BACKUP_CODE") {
      return "That code isn't right. Check your authenticator and try again.";
    }
    if (code === "ACCOUNT_TEMPORARILY_LOCKED") {
      return "Too many attempts. Try again later.";
    }
    if (error.body?.message) return error.body.message;
  }
  return "Something went wrong. Try again.";
}

/**
 * Kills every session except the one the plugin just minted.
 *
 * Both `verifyTOTP` (on the enrolment confirm) and `disableTwoFactor` rotate
 * the caller's session — new row created, old row deleted, cookie replaced —
 * so by the time this runs, the newest session for the user IS the caller.
 * The request's own cookie still names the deleted row, which is why this
 * keys on recency instead. Deleting rows is revocation here: the session
 * cookie cache is off (see `lib/auth.ts`), so a deleted row fails the very
 * next request.
 */
async function revokeAllButNewestSession(userId: string): Promise<void> {
  const db = getDb();
  const newest = await db.query.session.findFirst({
    where: eq(sessionTable.userId, userId),
    orderBy: [desc(sessionTable.createdAt)],
    columns: { id: true },
  });
  if (!newest) return;
  await db
    .delete(sessionTable)
    .where(and(eq(sessionTable.userId, userId), ne(sessionTable.id, newest.id)));
}

/** Loud, both ways: other sessions die and the owner hears about it. */
async function announceTwoFactorChange(userId: string, enabled: boolean): Promise<void> {
  await revokeAllButNewestSession(userId);

  const owner = await getDb().query.user.findFirst({
    where: eq(userTable.id, userId),
    columns: { email: true, name: true },
  });
  if (!owner) return;

  const result = await sendTwoFactorChanged({
    to: owner.email,
    name: owner.name,
    enabled,
  });
  if (!result.sent) {
    console.warn(`[sailo] two-factor change email not sent: ${result.reason}`);
  }
}

/* -------------------------------------------------------------------------- */
/*  Two-factor authentication                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Step one of enrolment: prove the password, mint a secret, hand back the QR
 * and the backup codes. Nothing is *on* yet — the plugin keeps the secret
 * `verified: false` until `confirmTwoFactorEnrolment` sees a real code, so
 * abandoning this screen locks nobody out.
 */
export async function beginTwoFactorEnrolment(
  _prev: SecurityActionState,
  formData: FormData,
): Promise<SecurityActionState> {
  const password = String(formData.get("password") ?? "");
  if (!password) return { ok: false, error: "Enter your password." };

  try {
    const result = await auth.api.enableTwoFactor({
      body: { password },
      headers: await headers(),
    });

    return {
      ok: true,
      totpUri: result.totpURI,
      // Rendered as an <img> — a data URL keeps the page self-contained and
      // the secret out of any request log.
      qrDataUrl: await toDataURL(result.totpURI, { margin: 1, width: 220 }),
      backupCodes: result.backupCodes,
    };
  } catch (error) {
    return { ok: false, error: refusalMessage(error) };
  }
}

/**
 * Step two: one valid code flips 2FA on. The plugin verifies against the
 * pending secret (constant-time, ±1 step drift) and only then sets
 * `user.twoFactorEnabled` — the guard that stops a seller enabling a secret
 * their authenticator never actually scanned.
 */
export async function confirmTwoFactorEnrolment(
  _prev: SecurityActionState,
  formData: FormData,
): Promise<SecurityActionState> {
  const session = await getSession();
  if (!session?.user) return { ok: false, error: "Sign in again to continue." };

  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { ok: false, error: "Enter the six-digit code." };

  try {
    await auth.api.verifyTOTP({
      body: { code },
      headers: await headers(),
    });
  } catch (error) {
    return { ok: false, error: refusalMessage(error) };
  }

  await announceTwoFactorChange(session.user.id, true);
  revalidatePath("/admin/settings/security");
  return { ok: true };
}

/**
 * Turning 2FA off demands the same proof as using it: the password *and* a
 * current code (TOTP or an unused backup code). The password alone must never
 * be enough — a stolen password quietly disabling 2FA is precisely the attack
 * the feature exists to stop.
 */
export async function disableTwoFactor(
  _prev: SecurityActionState,
  formData: FormData,
): Promise<SecurityActionState> {
  const session = await getSession();
  if (!session?.user) return { ok: false, error: "Sign in again to continue." };

  const password = String(formData.get("password") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  if (!password || !code) {
    return { ok: false, error: "Enter your password and a current code." };
  }

  const reqHeaders = await headers();

  /*
   * The code first, then the password (inside `disableTwoFactor`). Six digits
   * means the authenticator; anything else is tried as a backup code, which
   * is single-use — the plugin consumes it on success. A consumed code
   * against a mistyped password costs one spare code; the reverse order would
   * let a password-only caller find out whether the password works before
   * ever producing a code, which is information they haven't earned.
   */
  try {
    if (/^\d{6}$/.test(code)) {
      await auth.api.verifyTOTP({ body: { code }, headers: reqHeaders });
    } else {
      await auth.api.verifyBackupCode({
        body: { code, disableSession: true },
        headers: reqHeaders,
      });
    }
  } catch (error) {
    return { ok: false, error: refusalMessage(error) };
  }

  try {
    await auth.api.disableTwoFactor({
      body: { password },
      headers: reqHeaders,
    });
  } catch (error) {
    return { ok: false, error: refusalMessage(error) };
  }

  await announceTwoFactorChange(session.user.id, false);
  revalidatePath("/admin/settings/security");
  return { ok: true };
}

/**
 * A fresh set of backup codes, shown once. The plugin overwrites the stored
 * set, so every code from the old sheet stops working the moment this runs —
 * which is the point of regenerating.
 */
export async function regenerateBackupCodes(
  _prev: SecurityActionState,
  formData: FormData,
): Promise<SecurityActionState> {
  const password = String(formData.get("password") ?? "");
  if (!password) return { ok: false, error: "Enter your password." };

  try {
    const result = await auth.api.generateBackupCodes({
      body: { password },
      headers: await headers(),
    });
    return { ok: true, backupCodes: result.backupCodes };
  } catch (error) {
    return { ok: false, error: refusalMessage(error) };
  }
}

/* -------------------------------------------------------------------------- */
/*  Login sessions                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Light ceiling on the revoke actions — a person clicks these a handful of
 * times; only a script hits thirty a minute.
 */
async function revokeGate(userId: string): Promise<boolean> {
  const verdict = await rateLimit(`session-revoke:${userId}`, 30, 60);
  return verdict.allowed;
}

/**
 * Terminates one session by its row id.
 *
 * The id, never the token: tokens are bearer credentials and must not round-
 * trip through the page (spec 02 rule 1). The ownership check resolves id →
 * row and refuses a foreign id with the same words as a missing one, so the
 * action discloses nothing about whether someone else's session id exists.
 */
export async function revokeSessionById(
  _prev: SecurityActionState,
  formData: FormData,
): Promise<SecurityActionState> {
  const session = await getSession();
  if (!session?.user) return { ok: false, error: "Sign in again to continue." };

  if (!(await revokeGate(session.user.id))) {
    return { ok: false, error: "Too many attempts. Try again later." };
  }

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Session not found." };

  const db = getDb();
  const row = await db.query.session.findFirst({
    where: eq(sessionTable.id, id),
    columns: { id: true, token: true, userId: true },
  });

  // One message for "no such row" and "not your row" — an IDOR probe learns
  // nothing either way.
  if (!row || row.userId !== session.user.id) {
    return { ok: false, error: "Session not found." };
  }

  // The current session's row ends with sign-out, not with this button — the
  // UI disables it there; this is the belt for the braces.
  if (row.token === session.session.token) {
    return { ok: false, error: "This is your current session — sign out instead." };
  }

  // Deleting the row IS the revocation: the cookie cache is off, so the very
  // next request carrying this session's cookie fails its lookup.
  await db.delete(sessionTable).where(eq(sessionTable.id, row.id));

  revalidatePath("/admin/settings/security");
  return { ok: true };
}

/** "Sign out all other sessions" — leaves exactly the caller signed in. */
export async function revokeOtherSessions(
  _prev: SecurityActionState,
  _formData: FormData,
): Promise<SecurityActionState> {
  const session = await getSession();
  if (!session?.user) return { ok: false, error: "Sign in again to continue." };

  if (!(await revokeGate(session.user.id))) {
    return { ok: false, error: "Too many attempts. Try again later." };
  }

  await getDb()
    .delete(sessionTable)
    .where(
      and(
        eq(sessionTable.userId, session.user.id),
        ne(sessionTable.token, session.session.token),
      ),
    );

  revalidatePath("/admin/settings/security");
  return { ok: true };
}
