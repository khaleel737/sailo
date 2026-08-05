/**
 * Who is allowed into /hq — the panel Sailo runs its own business from, as
 * opposed to /admin, which is the one a seller runs their shop from.
 *
 * There is deliberately no sign-up, no invite flow and no role column. Access
 * is an allowlist of email addresses, checked against the signed-in session on
 * every request. Two people run this company; a permissions system would be
 * more code to get wrong than the thing it protects.
 *
 * Pure on purpose — no database, no `next/*` imports — so the guards in
 * `lib/session.ts` and a unit test can both read it.
 */

/**
 * The default roster. Overridden wholesale by SAILO_STAFF_EMAILS (comma
 * separated) so adding or removing someone is an environment variable and a
 * redeploy, not a code change.
 */
const DEFAULT_STAFF = [
  "khaleelmusleh@gmail.com",
  "uncolored.inc@gmail.com",
] as const;

export function staffEmails(): string[] {
  const configured = process.env.SAILO_STAFF_EMAILS;
  const source = configured ? configured.split(",") : DEFAULT_STAFF;

  const list = source.map((email) => email.trim().toLowerCase()).filter(Boolean);

  // An env var set to "" or "," would otherwise open the panel to nobody and
  // read as a lockout bug. Fall back rather than silently locking the founders
  // out of their own dashboard.
  return list.length > 0 ? list : [...DEFAULT_STAFF];
}

/**
 * Case-insensitive, whitespace-tolerant. Gmail's dots-and-plus aliasing is
 * *not* normalised: `k.haleel@gmail.com` reaches the same inbox but is a
 * different account here, and treating them as equal would let anyone who can
 * register an alias of a staff address walk in.
 */
export function isStaffEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return staffEmails().includes(email.trim().toLowerCase());
}
