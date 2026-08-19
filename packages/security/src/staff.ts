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
 * `@sailo/security/roster`) and there are roles and capabilities, listed below.
 * A role is a job title; a capability is a single act. The roles exist so that
 * granting access is one choice rather than ten, and the capabilities exist so
 * that the guard on an action names the act — `requireStaff("money:move")` —
 * rather than the job title of whoever is expected to be doing it.
 *
 * WHY THE CAPABILITY IS WHAT THE GUARD NAMES
 * For a while these were declared and almost entirely unenforced: two of them
 * were checked, and every other action in the panel opened with a bare
 * `requireStaff()`. A support member could suspend any shop on the platform,
 * comp a plan, clear a seller's second factor, refund a charge and download
 * every buyer's address in a CSV — because the *page* was staff-only and
 * nothing under it asked a narrower question. Capabilities that are declared
 * and not checked are worse than none: they read like a control in review, and
 * they are a comment.
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
 * Four. It was three, and the header used to argue that three was the design —
 * that two would not separate "can answer a ticket" from "can move money", and
 * that a fourth "starts inventing distinctions nobody has yet asked for".
 *
 * That argument was right about the shape and wrong about the count, and what
 * changed is that the distinction got asked for. HQ now has a risk desk: a
 * screen whose whole job is to look at shops that may be defrauding buyers and
 * act on them — suspend the storefront, sign the account out, hand a locked-out
 * seller their account back. Under three roles the only place to put that work
 * was `admin`, which also signs off refunds, pays partners, comps plans and
 * downloads every buyer's personal data in one CSV. Somebody staffing the risk
 * desk does not need any of those, and a role that hands them over anyway is
 * not a permission system, it is a note in an onboarding doc.
 *
 * The ordering below is not a hierarchy the code walks. `can()` reads an
 * explicit grant table instead, because a numeric rank quietly answers
 * questions nobody thought about — it is what makes "support is level 1, so of
 * course it inherits everything at level 0" true by accident rather than by
 * decision. The grants happen to nest today; nothing enforces that they must,
 * and the table is the place to break the nesting when a role finally needs it.
 * ────────────────────────────────────────────────────────────────────────── */

export const STAFF_ROLES = ["owner", "admin", "risk", "support"] as const;

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
  risk: "Works the risk desk: suspend a shop, secure or recover an account. No money, no bulk export.",
  support: "Read, answer tickets, and sign a compromised account out. Nothing else.",
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
   * Take access *away* from a seller's account on their behalf: end one
   * session, end all of them, revoke an API key.
   *
   * Support holds this, and that is deliberate rather than an oversight about
   * how dangerous the account page is. Every act under this capability makes an
   * account strictly *less* reachable, so the damage a mistake does is an
   * inconvenienced seller who signs in again — and the thing it defends against
   * is somebody already inside a seller's account at three in the morning,
   * which is exactly when the person on shift is support. A containment button
   * that needs an escalation is a containment button that arrives late.
   */
  | "account:secure"
  /**
   * Give access *back*: clear a second factor the owner can no longer produce.
   *
   * Split from `account:secure` because the two point in opposite directions.
   * This one ends with somebody signing in who could not sign in before, and
   * the only thing standing between it and a full account takeover is whether
   * the person on the phone was really the seller. That is a judgement, it is
   * the exact judgement social engineering attacks, and it does not belong to
   * whoever happens to be answering the queue.
   */
  | "account:recover"
  /**
   * Take a shop off the air, put it back, or stop its marketing. Separate from
   * `money:move` because the blast radius is different in kind — this is the
   * seller's whole livelihood rather than one transaction.
   */
  | "account:suspend"
  /**
   * Grant a plan we are not charging for, or take one back.
   *
   * Its own capability rather than living under `money:move`, because it is the
   * mirror image: `money:move` sends money that is already somebody's, and this
   * quietly forgoes revenue that would have been ours. Nothing in Stripe
   * records it and no invoice ever mentions it, so the audit row this writes is
   * the only place a comped plan is ever accounted for.
   */
  | "billing:grant"
  /**
   * Anything that moves money or commits us to a position on it: refunds,
   * partner payouts, submitting dispute evidence to Stripe.
   */
  | "money:move"
  /**
   * Send from Sailo's own list — a campaign, or a scheduled send going out now.
   *
   * A capability rather than an assumption because the blast radius is the one
   * thing on this panel that cannot be undone by clicking again: a campaign
   * sent to every subscriber is sent. It is also the one act here whose damage
   * is to the sending domain's reputation, which is shared with every seller's
   * order receipts.
   */
  | "marketing:send"
  /**
   * Download the platform in a spreadsheet: every account, every buyer, every
   * live session.
   *
   * Reading one seller's page and exporting all of them are not the same act,
   * however identical the rows. One is support work with a name attached; the
   * other is a file on a laptop containing every buyer's name, email and
   * address, which leaves the building the moment it is saved and which no
   * revocation reaches afterwards. This is the capability a breach report ends
   * up being about.
   */
  | "data:export"
  /**
   * Answer a **buyer's** data request on a seller's behalf — spec 52.
   *
   * Its own capability rather than `data:export`, and the distinction is not
   * bureaucratic. `data:export` is downloading rows *for Sailo*: a support
   * question, a spreadsheet, our own decision. This is acting as the seller in
   * front of that seller's customer, under a statutory clock, and half of what
   * it can do is an **erasure** — which `data:export` does not describe at all
   * and which no amount of exporting could ever perform.
   *
   * HQ needs it because a seller can vanish, refuse, or simply not answer, and
   * the obligation does not vanish with them. Every use writes the acting
   * address into `data_requests.actor`, so "the seller answered" and "we
   * answered for them" are never the same row.
   */
  | "privacy:act"
  /**
   * Submit evidence to a card network on **Sailo's own** behalf — spec 46.
   *
   * Separate from `money:move`, because spec 46 asks for exactly that split:
   * contesting a platform chargeback and refunding it are two different
   * decisions and the second is the one that moves money. Contesting spends the
   * single response Stripe allows and commits Sailo to a position in front of a
   * network; refunding gives revenue back. Somebody may reasonably hold the
   * first and not the second — that is the risk desk — and collapsing them
   * would put the desk one click from a refund it does not own.
   */
  | "platform:contest"
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
  owner: [
    "read",
    "notes:write",
    "account:secure",
    "account:recover",
    "account:suspend",
    "billing:grant",
    "money:move",
    "marketing:send",
    "data:export",
    "privacy:act",
    "platform:contest",
    "members:manage",
  ],
  admin: [
    "read",
    "notes:write",
    "account:secure",
    "account:recover",
    "account:suspend",
    "billing:grant",
    "money:move",
    "marketing:send",
    "data:export",
    "privacy:act",
    "platform:contest",
  ],
  risk: [
    "read",
    "notes:write",
    "account:secure",
    "account:recover",
    "account:suspend",
    /*
     * The dispute desk's own act, and not the refund beside it. Answering a
     * chargeback against Sailo is the job this role exists for; giving revenue
     * back is `money:move`, which risk does not hold.
     *
     * `privacy:act` is deliberately absent. A risk analyst has no business
     * deleting a buyer's records on a seller's behalf — the shape of that
     * mistake is a support ticket answered by erasing the complainant.
     */
    "platform:contest",
  ],
  support: ["read", "notes:write", "account:secure"],
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

/**
 * Every capability a role holds, for the screen that explains the roles.
 *
 * Derived from the same table `can()` reads rather than written out again
 * beside it: a roster page that lists a grant the checker does not honour is
 * worse than a roster page that lists nothing, because somebody will staff
 * around it.
 */
export function capabilitiesFor(role: StaffRole): readonly StaffCapability[] {
  return GRANTS[role];
}
