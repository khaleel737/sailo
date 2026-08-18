import "server-only";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { session, staffMembers, user } from "@sailo/db/schema";
import { isStaffEmail, PASSWORD_PATHS, type StaffRole } from "./staff";

/**
 * The roster, read and written.
 *
 * `./staff.ts` decides what a role *means* and stays pure so anything can ask.
 * This is the half that needs a database: turning an address into a role,
 * listing who is in, and the three writes that change it.
 *
 * Every function here lowercases the address it is given. The column is unique
 * and the rows are written lowercased, so a mixed-case invite and a lowercase
 * session must land on the same row — and the one place that is allowed to
 * disagree about it is nowhere.
 */

/** Addresses are compared lowercased and trimmed, everywhere, without exception. */
function normalise(email: string): string {
  return email.trim().toLowerCase();
}

export type StaffMember = {
  email: string;
  role: StaffRole;
  note: string | null;
  invitedByEmail: string | null;
  invitedAt: Date;
  revokedAt: Date | null;
  revokedByEmail: string | null;
  lastSeenAt: Date | null;
};

/**
 * Who this address is, or null if they are nobody.
 *
 * The single question the panel's guard asks, and the only function here that
 * runs on every request.
 *
 * TWO WAYS IN, AND THE ORDER MATTERS
 * The table is consulted first. `SAILO_STAFF_EMAILS` is consulted only if the
 * table has nothing to say about the address — never as an override — because
 * the opposite order would make revocation a lie: an address left in that
 * variable would keep working after someone had revoked it in the UI and
 * watched the row turn red. Revoking is the operation this whole feature
 * exists for, so it wins.
 *
 * A revoked row therefore beats the environment variable, which is the one
 * behaviour worth stating out loud: if you revoke a founder whose address is
 * also in `SAILO_STAFF_EMAILS`, they are out, and putting them back means
 * un-revoking the row rather than editing the variable.
 */
export async function lookupStaff(
  email: string | null | undefined,
): Promise<{ email: string; role: StaffRole } | null> {
  if (!email) return null;
  const address = normalise(email);

  const row = await getDb().query.staffMembers.findFirst({
    where: eq(staffMembers.email, address),
    columns: { role: true, revokedAt: true },
  });

  if (row) return row.revokedAt ? null : { email: address, role: row.role };

  /*
   * No row at all. Fall through to the break-glass list — see the comment on
   * `staffEmails()` for why it grants `owner`: the only reason to arrive this
   * way is that the roster cannot yet be repaired from inside the panel, and
   * repairing it is an owner's power.
   */
  return isStaffEmail(address) ? { email: address, role: "owner" } : null;
}

/**
 * The roster as the members page shows it: active first, then the revoked, so
 * the audit trail is on the same screen as the thing it audits rather than
 * behind a filter nobody clicks.
 */
export async function listStaff(): Promise<StaffMember[]> {
  const rows = await getDb()
    .select({
      email: staffMembers.email,
      role: staffMembers.role,
      note: staffMembers.note,
      invitedByEmail: staffMembers.invitedByEmail,
      invitedAt: staffMembers.invitedAt,
      revokedAt: staffMembers.revokedAt,
      revokedByEmail: staffMembers.revokedByEmail,
      lastSeenAt: staffMembers.lastSeenAt,
    })
    .from(staffMembers)
    .orderBy(
      // Active before revoked; within each group, most recent first.
      sql`(${staffMembers.revokedAt} is not null)`,
      desc(staffMembers.invitedAt),
    );
  return rows;
}

/**
 * Add someone, or bring a revoked member back.
 *
 * An upsert rather than an insert, because the second case is real and common:
 * a contractor returns, and the natural gesture is to invite them again. An
 * insert would fail on the unique index and surface as "that address is already
 * a member" — which is both confusing and false, since they had been removed.
 *
 * Re-inviting clears `revokedAt` and re-stamps who invited them, so the row
 * always describes the *current* grant. The previous revocation is not
 * preserved on the row; what preserves it is that this is an ordinary audited
 * write and the panel logs it.
 */
export async function inviteStaff(input: {
  email: string;
  role: StaffRole;
  invitedByEmail: string;
  note?: string | null;
}): Promise<{ email: string }> {
  const address = normalise(input.email);
  await getDb()
    .insert(staffMembers)
    .values({
      email: address,
      role: input.role,
      invitedByEmail: normalise(input.invitedByEmail),
      note: input.note?.trim() || null,
    })
    .onConflictDoUpdate({
      target: staffMembers.email,
      set: {
        role: input.role,
        invitedByEmail: normalise(input.invitedByEmail),
        note: input.note?.trim() || null,
        invitedAt: new Date(),
        revokedAt: null,
        revokedByEmail: null,
      },
    });
  return { email: address };
}

/**
 * End someone's access, now.
 *
 * Two writes, and the second is the one that matters. Marking the row revoked
 * stops the *next* request; it does nothing about the session they are holding
 * right now, which — because sessions here last thirty days and there is
 * deliberately no cookie cache — is a live key in an open browser.
 *
 * So their sessions are deleted too. "Revoked" has to mean revoked at the
 * moment you click it, not at the moment their cookie happens to expire; the
 * whole reason to build revocation was the person you no longer trust, and
 * telling them to please close their laptop is not an access control.
 *
 * Returns how many sessions were killed so the UI can say so — "revoked, 2
 * sessions ended" is the confirmation that the thing you feared is actually
 * over.
 */
export async function revokeStaff(input: {
  email: string;
  revokedByEmail: string;
}): Promise<{ sessionsEnded: number }> {
  const address = normalise(input.email);
  const db = getDb();

  await db
    .update(staffMembers)
    .set({ revokedAt: new Date(), revokedByEmail: normalise(input.revokedByEmail) })
    .where(and(eq(staffMembers.email, address), isNull(staffMembers.revokedAt)));

  /*
   * Deleted by user id resolved from the address, because `session` has no
   * email column. A staff member with no `user` row has never signed in and so
   * holds nothing to end — that is the invited-but-not-yet-arrived case, and it
   * is a no-op rather than an error.
   */
  const account = await db.query.user.findFirst({
    where: eq(user.email, address),
    columns: { id: true },
  });
  if (!account) return { sessionsEnded: 0 };

  const killed = await db
    .delete(session)
    .where(eq(session.userId, account.id))
    .returning({ id: session.id });

  return { sessionsEnded: killed.length };
}

/**
 * Change what someone is allowed to do.
 *
 * Only touches active rows: re-roling a revoked member would silently let them
 * back in, since `lookupStaff` reads the role off any row whose `revokedAt` is
 * null and this would have to clear it to be meaningful. Bringing someone back
 * is `inviteStaff`, which says so in its name.
 */
export async function setStaffRole(input: {
  email: string;
  role: StaffRole;
}): Promise<void> {
  await getDb()
    .update(staffMembers)
    .set({ role: input.role })
    .where(
      and(eq(staffMembers.email, normalise(input.email)), isNull(staffMembers.revokedAt)),
    );
}

/**
 * How stale `lastSeenAt` is allowed to get. Fifteen minutes, because the
 * question it answers is "is this account still in use", and no answer to that
 * changes with a finer resolution.
 */
const SEEN_THROTTLE_MS = 15 * 60 * 1000;

/**
 * Note that this address opened the panel.
 *
 * Throttled in SQL rather than in the caller, so concurrent requests cannot
 * race into two writes: the `WHERE` decides, and a request that loses simply
 * updates nothing. Without the throttle this is a write on every page view of
 * an app made entirely of tables — the roster would be the most-written table
 * in the database, to record something nobody reads at that resolution.
 *
 * Deliberately not awaited by the guard that calls it. A failure here must
 * never be able to refuse a staff member entry: the worst case is a stale
 * timestamp on a screen nobody is looking at.
 */
export async function touchStaffSeen(email: string): Promise<void> {
  const cutoff = new Date(Date.now() - SEEN_THROTTLE_MS);
  await getDb()
    .update(staffMembers)
    .set({ lastSeenAt: new Date() })
    .where(
      and(
        eq(staffMembers.email, normalise(email)),
        isNull(staffMembers.revokedAt),
        or(isNull(staffMembers.lastSeenAt), sql`${staffMembers.lastSeenAt} < ${cutoff}`),
      ),
    );
}


/**
 * The two better-auth endpoints a staff address must never reach.
 *
 * The roster-backed twin of `refusesPasswordAuth` in `./staff.ts`, which
 * answers from the environment variable alone. That was the whole roster once;
 * it is now the break-glass list, so a member invited through the panel would
 * have passed the pure check and been allowed to set a password on the seller
 * door — which is precisely the account-takeover chain `staff.ts` documents at
 * length and the `hooks.before` refusal exists to break.
 *
 * A revoked member is *not* refused here, deliberately. Once someone is off the
 * roster they are an ordinary person, and an ordinary person may hold a seller
 * account with a password like anyone else. The refusal protects addresses that
 * are currently staff.
 *
 * Async, unlike its pure twin, because it reads a table. That is fine at every
 * call site: better-auth's `before` hook is already async.
 */
export async function refusesPasswordAuthForRoster(
  path: string,
  email: unknown,
): Promise<boolean> {
  if (!(PASSWORD_PATHS as readonly string[]).includes(path)) return false;
  if (typeof email !== "string") return false;
  return (await lookupStaff(email)) !== null;
}
