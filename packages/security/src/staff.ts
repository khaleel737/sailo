/**
 * Who is allowed into apps/hq — the panel Sailo runs its own business from,
 * as opposed to apps/web's `/admin`, which is the one a *seller* runs their
 * shop from. Two different products; the domain is what tells them apart
 * (`hq.sailo.store` against `sailo.store/admin`).
 *
 * This file used to open by saying there was "deliberately no sign-up, no
 * invite flow and no role column", on the reasoning that a handful of people
 * run this company and a permissions system would be more code to get wrong
 * than the thing it protects. That held while the roster was the founders. It
 * stopped holding the moment the first person who was not a founder needed to
 * answer a support ticket, because the allowlist had exactly one level and it
 * was "everything": read every seller's revenue, move money, suspend a shop.
 *
 * So there is now a roster (`staff_members`, read through
 * `@sailo/security/roster`) and there are roles — three of them, listed below,
 * chosen to be the fewest that let someone answer tickets without also being
 * able to issue refunds.
 *
 * WHAT STAYED HERE, AND WHY THIS FILE IS STILL PURE
 * No database, no `next/*` imports. The role vocabulary and the capability
 * check are decisions, not lookups: `can()` answers from a role it is handed,
 * so the auth config, a Server Component, a route handler and a unit test can
 * all ask the same question without one of them needing a connection. The
 * lookup that turns an *address* into a role is the database's job and lives
 * in `./roster.ts`.
 */

/**
 * BREAK-GLASS ONLY. The roster proper is the `staff_members` table.
 *
 * This is the list that admits when the database cannot answer — a fresh
 * environment with no rows in it yet, or the migration that creates the table
 * having not run. Without it the first deploy of the staff panel is a locked
 * door with the key inside: nobody can sign in to invite anybody, because
 * inviting is done from inside.
 *
 * Kept deliberately small and separate from the roles below: an address that
 * gets in this way is treated as `owner`, because the only reason to use this
 * path is to repair the roster, and repairing it is an owner's power. That is
 * a real grant, so `SAILO_STAFF_EMAILS` should hold the founders and nobody
 * else — a contractor left in this variable is a contractor who cannot be
 * revoked from the UI, since revocation writes a table this path never reads.
 *
 * Overridden wholesale by SAILO_STAFF_EMAILS (comma separated).
 *
 * One dedicated address, not the founders' personal Gmails: this account
 * exists only to open /hq, signs in by magic link, and its inbox lives on a
 * domain we control. A personal address on this list makes every place that
 * inbox is signed in — a phone, an old laptop — part of the panel's attack
 * surface.
 */
const DEFAULT_STAFF = ["admin@sailo.store"] as const;

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

/**
 * The two better-auth endpoints a staff address must never reach.
 *
 * A roster account signs in by magic link and holds no password — that is
 * stated at the top of this file, and until it was enforced it was only a
 * description. Anyone could sign up as `admin@sailo.store` with a password of
 * their own choosing; better-auth then mailed the real inbox a confirmation
 * indistinguishable from a colleague's, and one click set `emailVerified`
 * without disturbing the attacker's credential. `requireStaff` asks for a
 * rostered address and a verified one, and at that point both were true.
 *
 * Sign-in is refused as well as sign-up so that a row written before this
 * existed cannot be used either.
 *
 * A separate function from `isStaffEmail` because it answers a different
 * question — not "is this person staff" but "may this request use a password"
 * — and because the auth config that calls it cannot be unit tested without a
 * database, while this can.
 */
/*
 * Exported so `./roster.ts`'s database-backed twin refuses the same two paths.
 * Two hand-kept lists is one list that will one day be missing an endpoint.
 */
export const PASSWORD_PATHS = ["/sign-up/email", "/sign-in/email"] as const;

export function refusesPasswordAuth(path: string, email: unknown): boolean {
  if (!(PASSWORD_PATHS as readonly string[]).includes(path)) return false;
  return isStaffEmail(typeof email === "string" ? email : null);
}

/* ────────────────────────────────────────────────────────────────────────────
 * ROLES
 *
 * Three, and the number is the design. Two would not separate "can answer a
 * ticket" from "can move money", which is the split that made roles necessary
 * at all. Four starts inventing distinctions nobody has yet asked for, and an
 * unused role is a role whose grants have never been checked against reality.
 *
 * The ordering below is not a hierarchy the code walks. `can()` reads an
 * explicit grant table instead, because a numeric rank quietly answers
 * questions nobody thought about — it is what makes "support is level 1, so of
 * course it inherits everything at level 0" true by accident rather than by
 * decision.
 * ────────────────────────────────────────────────────────────────────────── */

export const STAFF_ROLES = ["owner", "admin", "support"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

/**
 * What each role is *for*, in one line, shown beside it in the roster UI so the
 * person granting it is reading the same description this file is written to.
 */
export const STAFF_ROLE_SUMMARY: Record<StaffRole, string> = {
  owner: "Everything, including managing this roster.",
  admin: "Everything except managing the roster.",
  support: "Read, and answer tickets. Cannot move money or suspend a shop.",
};

/**
 * The things a member can be allowed to do.
 *
 * Named for the *act*, not the screen. `money:move` rather than `refunds:page`,
 * because the same authority is reached from the orders table, the dispute
 * detail and the partner payout queue, and a permission named after one of
 * those three would have been checked in one place and forgotten in the others.
 */
export type StaffCapability =
  /** Read anything in the panel: accounts, orders, revenue, disputes. */
  | "read"
  /** Write an internal note on an account or a ticket. Visible only to staff. */
  | "notes:write"
  /**
   * Anything that moves money or commits us to a position on it: refunds,
   * partner payouts, submitting dispute evidence to Stripe.
   */
  | "money:move"
  /**
   * Take a shop off the air, put it back, or block an address. Separate from
   * `money:move` because the blast radius is different in kind — this is the
   * seller's whole livelihood rather than one transaction.
   */
  | "account:suspend"
  /** Invite, revoke, or change someone's role. */
  | "members:manage";

/**
 * The grants, written out.
 *
 * Deliberately a literal table rather than a rule. It is longer than
 * `rank >= 2`, and it is the only form where reviewing "who can suspend a
 * shop?" means reading one line instead of simulating a comparison.
 */
const GRANTS: Record<StaffRole, readonly StaffCapability[]> = {
  owner: ["read", "notes:write", "money:move", "account:suspend", "members:manage"],
  admin: ["read", "notes:write", "money:move", "account:suspend"],
  support: ["read", "notes:write"],
};

/**
 * May this role do this thing.
 *
 * Total and pure: no session, no database, no request. Callers resolve the role
 * once — `requireStaff()` in apps/hq does it — and ask this as many times as
 * the page needs.
 *
 * Note what is *not* here: there is no `can(role, capability, resource)`. Staff
 * authority is uniform across the platform by design — someone who can suspend
 * one shop can suspend any of them — so a per-resource argument would be a
 * parameter every caller passes and nothing reads, which is worse than absent.
 */
export function can(role: StaffRole, capability: StaffCapability): boolean {
  return GRANTS[role].includes(capability);
}
