import { afterEach, describe, expect, it } from "vitest";
import {
  can,
  capabilitiesFor,
  isStaffEmail,
  isStaffRole,
  refusesPasswordAuth,
  staffEmails,
  STAFF_ROLES,
  type StaffCapability,
} from "./staff";

/**
 * Every capability there is, written out so the exhaustiveness checks below
 * have something to iterate.
 *
 * Deliberately a literal and not derived from the grant table: deriving it
 * would make "every capability is granted to somebody" tautological, since the
 * only capabilities in the list would be the ones already in the table. Adding
 * a member to `StaffCapability` and not to this array is a type error.
 */
const ALL_CAPABILITIES = [
  "read",
  "notes:write",
  "account:secure",
  "account:recover",
  "account:suspend",
  "billing:grant",
  "money:move",
  "marketing:send",
  "data:export",
  "members:manage",
] as const satisfies readonly StaffCapability[];

/**
 * The whole of /hq's authorization model.
 *
 * There is no role column and no invite flow — an email either appears on this
 * list or it does not, and that single comparison is what stands between the
 * public internet and the panel Sailo runs its own business from. Its own
 * header said a unit test should exist. None did.
 */

const original = process.env.SAILO_STAFF_EMAILS;

afterEach(() => {
  if (original === undefined) delete process.env.SAILO_STAFF_EMAILS;
  else process.env.SAILO_STAFF_EMAILS = original;
});

/** The roster with the environment override cleared. */
function withoutOverride(): string[] {
  delete process.env.SAILO_STAFF_EMAILS;
  return staffEmails();
}

describe("staffEmails", () => {
  it("falls back to the built-in roster when nothing is configured", () => {
    expect(withoutOverride().length).toBeGreaterThan(0);
  });

  it("ships only the dedicated staff address, on our own domain", () => {
    /*
     * The roster was once the founders' personal Gmails. Those inboxes are
     * signed in on phones and old laptops, and each one was a way into /hq.
     * Access now belongs to one purpose-made address; putting a personal
     * account back on this list should have to argue with this test first.
     */
    expect(withoutOverride()).toEqual(["admin@sailo.store"]);
  });

  it("returns every address lowercased", () => {
    process.env.SAILO_STAFF_EMAILS = "Someone@Example.COM,OTHER@example.com";
    expect(staffEmails()).toEqual(["someone@example.com", "other@example.com"]);
  });

  it("tolerates the spaces a human leaves after a comma", () => {
    process.env.SAILO_STAFF_EMAILS = "one@example.com,  two@example.com ";
    expect(staffEmails()).toEqual(["one@example.com", "two@example.com"]);
  });

  it("replaces the roster rather than adding to it", () => {
    /*
     * The point of the override: removing someone has to actually remove them.
     * If it merged with the defaults, a departing founder would keep access
     * until a code change and nobody would notice, because the panel would
     * keep working for everyone who was supposed to have it.
     */
    process.env.SAILO_STAFF_EMAILS = "only@example.com";
    expect(staffEmails()).toEqual(["only@example.com"]);
    for (const built of withoutOverride()) {
      process.env.SAILO_STAFF_EMAILS = "only@example.com";
      expect(staffEmails()).not.toContain(built);
    }
  });

  it.each(["", "   ", ",", " , , "])(
    "keeps the built-in roster when the override is empty (%j)",
    (value) => {
      /*
       * An env var cleared by hand, or set to a stray comma, would otherwise
       * produce an empty allowlist — which denies everyone and reads exactly
       * like a broken deploy rather than a configuration mistake.
       */
      process.env.SAILO_STAFF_EMAILS = value;
      const roster = staffEmails();
      expect(roster.length).toBeGreaterThan(0);
      expect(roster).toEqual(withoutOverride());
    },
  );
});

describe("isStaffEmail", () => {
  it("admits an address on the roster", () => {
    process.env.SAILO_STAFF_EMAILS = "staff@example.com";
    expect(isStaffEmail("staff@example.com")).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    // Providers hand back display-cased addresses; a session may carry either.
    process.env.SAILO_STAFF_EMAILS = "staff@example.com";
    expect(isStaffEmail("  STAFF@Example.com  ")).toBe(true);
  });

  it("refuses an address that is not on it", () => {
    process.env.SAILO_STAFF_EMAILS = "staff@example.com";
    expect(isStaffEmail("someone@example.com")).toBe(false);
  });

  it.each([null, undefined, "", "   "])("refuses %j", (value) => {
    // A session with no email must never satisfy the check by being falsy in
    // the same way an empty roster is.
    expect(isStaffEmail(value)).toBe(false);
  });

  it("does not normalise Gmail's dot aliasing", () => {
    /*
     * `s.taff@gmail.com` reaches the same inbox as `staff@gmail.com`, but it
     * is a different account to sign up with. Treating them as equal would let
     * anyone able to register an alias of a staff address into /hq.
     */
    process.env.SAILO_STAFF_EMAILS = "staff@gmail.com";
    expect(isStaffEmail("s.taff@gmail.com")).toBe(false);
  });

  it("does not normalise Gmail's plus aliasing", () => {
    process.env.SAILO_STAFF_EMAILS = "staff@gmail.com";
    expect(isStaffEmail("staff+anything@gmail.com")).toBe(false);
  });

  it("does not match on a substring of a rostered address", () => {
    // A prefix or suffix match would admit `staff@example.com.attacker.tld`.
    process.env.SAILO_STAFF_EMAILS = "staff@example.com";
    expect(isStaffEmail("staff@example.com.attacker.tld")).toBe(false);
    expect(isStaffEmail("notstaff@example.com")).toBe(false);
    expect(isStaffEmail("staff@example.co")).toBe(false);
  });

  it("is not fooled by a unicode look-alike domain", () => {
    // `а` here is Cyrillic. It renders identically and is a different string.
    process.env.SAILO_STAFF_EMAILS = "staff@example.com";
    expect(isStaffEmail("stаff@example.com")).toBe(false);
  });

  it("reads the roster on every call, not once at import", () => {
    /*
     * The roster is an environment variable so that removing someone is a
     * redeploy rather than a code change. Caching it at module load would make
     * that promise false in a long-lived server process.
     */
    process.env.SAILO_STAFF_EMAILS = "first@example.com";
    expect(isStaffEmail("first@example.com")).toBe(true);

    process.env.SAILO_STAFF_EMAILS = "second@example.com";
    expect(isStaffEmail("first@example.com")).toBe(false);
    expect(isStaffEmail("second@example.com")).toBe(true);
  });
});

/**
 * The account pre-hijack this closes.
 *
 * A staff account signs in by magic link and holds no password — the top of
 * `staff.ts` has said so all along, and until this existed it was a
 * description rather than a rule. Anyone could sign up as the roster address
 * with a password of their choosing. Better-auth then mailed the *real* inbox
 * a confirmation identical to the one a colleague's own signup produces, and
 * `/send-verification-email` is unauthenticated, so it could be re-sent at
 * will. One click set `emailVerified` — and it did so without disturbing the
 * attacker's credential, because better-auth calls
 * `revokeUnprovenAccountAccess` on the magic-link path and not on this one.
 * `requireStaff` asks for a rostered address and a verified one; at that point
 * both were true, and /hq is every seller's revenue and every buyer's PII.
 */
describe("refusesPasswordAuth", () => {
  afterEach(() => {
    delete process.env.SAILO_STAFF_EMAILS;
  });

  it("refuses a staff address a password signup", () => {
    process.env.SAILO_STAFF_EMAILS = "staff@example.com";
    expect(refusesPasswordAuth("/sign-up/email", "staff@example.com")).toBe(true);
  });

  it("refuses a staff address a password sign-in too", () => {
    // Sign-up alone would leave any row written before this shipped usable.
    process.env.SAILO_STAFF_EMAILS = "staff@example.com";
    expect(refusesPasswordAuth("/sign-in/email", "staff@example.com")).toBe(true);
  });

  it("leaves every seller alone", () => {
    // Sellers are the overwhelming majority of both endpoints' traffic.
    process.env.SAILO_STAFF_EMAILS = "staff@example.com";
    for (const path of ["/sign-up/email", "/sign-in/email"]) {
      expect(refusesPasswordAuth(path, "seller@example.com"), path).toBe(false);
    }
  });

  it("does not block the magic link, which is how staff actually sign in", () => {
    process.env.SAILO_STAFF_EMAILS = "staff@example.com";
    expect(refusesPasswordAuth("/sign-in/magic-link", "staff@example.com")).toBe(false);
    expect(refusesPasswordAuth("/magic-link/verify", "staff@example.com")).toBe(false);
  });

  it("matches the roster the same way the guard does", () => {
    // Case and whitespace, since the endpoint takes whatever was typed.
    process.env.SAILO_STAFF_EMAILS = "staff@example.com";
    expect(refusesPasswordAuth("/sign-up/email", "  STAFF@Example.com  ")).toBe(true);
  });

  it("survives a body with no email, or a hostile one", () => {
    process.env.SAILO_STAFF_EMAILS = "staff@example.com";
    for (const value of [undefined, null, 42, {}, [], { toString: () => "staff@example.com" }]) {
      expect(refusesPasswordAuth("/sign-up/email", value)).toBe(false);
    }
  });

  it("refuses the default roster, not just a configured one", () => {
    // Production runs on the default unless SAILO_STAFF_EMAILS is set.
    delete process.env.SAILO_STAFF_EMAILS;
    for (const email of staffEmails()) {
      expect(refusesPasswordAuth("/sign-up/email", email), email).toBe(true);
    }
  });
});

/**
 * The grant table, asserted rather than described.
 *
 * These roles are the only thing standing between a support member and every
 * seller's money, and the table they read from is a literal — which means the
 * way it breaks is somebody adding a capability to the union and adding it to
 * `admin` "for now". So the assertions below are written as the sentences a
 * reviewer would ask out loud, one per role, and the exhaustiveness check at
 * the end fails when a new capability is declared and left ungranted anywhere.
 */
describe("can", () => {
  it("gives owner everything, because that is what owner means", () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(can("owner", capability), capability).toBe(true);
    }
  });

  it("withholds exactly one thing from admin: the roster", () => {
    /*
     * The one capability an admin deliberately does not have. A compromised
     * admin session can already do a great deal of damage; what must stay out
     * of its reach is the ability to *keep* the access — to invite a second
     * address, or to promote itself. An account that cannot extend its own
     * reach is an account whose damage ends when it is revoked.
     */
    const withheld = ALL_CAPABILITIES.filter((c) => !can("admin", c));
    expect(withheld).toEqual(["members:manage"]);
  });

  it("lets risk act on an account but never on money", () => {
    expect(can("risk", "account:suspend")).toBe(true);
    expect(can("risk", "account:secure")).toBe(true);
    expect(can("risk", "account:recover")).toBe(true);

    // The whole reason the role exists. Working the risk desk means suspending
    // shops all day; it does not mean being able to refund a charge, comp a
    // plan, mail every subscriber or download every buyer's address.
    expect(can("risk", "money:move")).toBe(false);
    expect(can("risk", "billing:grant")).toBe(false);
    expect(can("risk", "marketing:send")).toBe(false);
    expect(can("risk", "data:export")).toBe(false);
    expect(can("risk", "members:manage")).toBe(false);
  });

  it("lets support contain a compromised account but not reopen one", () => {
    /*
     * The split that makes `account:secure` safe to hand to the queue. Ending
     * sessions makes an account strictly less reachable and the worst case is a
     * seller who signs in again; clearing a second factor ends with somebody
     * signing in who could not before, and the only check on it is whether the
     * caller was really the seller.
     */
    expect(can("support", "account:secure")).toBe(true);
    expect(can("support", "account:recover")).toBe(false);
  });

  it("keeps support off everything that moves money or leaves the building", () => {
    for (const capability of [
      "money:move",
      "billing:grant",
      "account:suspend",
      "marketing:send",
      "data:export",
      "members:manage",
    ] as const) {
      expect(can("support", capability), capability).toBe(false);
    }
  });

  it("gives every role the two capabilities the panel is unusable without", () => {
    for (const role of STAFF_ROLES) {
      expect(can(role, "read"), role).toBe(true);
      expect(can(role, "notes:write"), role).toBe(true);
    }
  });

  it("grants every declared capability to at least one role", () => {
    /*
     * A capability nobody holds is a button nobody can press, and it fails as a
     * 403 on a screen that offered it. This is the check that catches a new
     * entry in the union that was added to the type and forgotten in the table.
     */
    const orphans = ALL_CAPABILITIES.filter(
      (capability) => !STAFF_ROLES.some((role) => can(role, capability)),
    );
    expect(orphans).toEqual([]);
  });

  it("reports the same grants through capabilitiesFor as through can", () => {
    // The roster page renders from `capabilitiesFor`. A screen that advertises
    // a grant the checker does not honour is worse than one that says nothing,
    // because somebody will staff around it.
    for (const role of STAFF_ROLES) {
      for (const capability of ALL_CAPABILITIES) {
        expect(capabilitiesFor(role).includes(capability), `${role}/${capability}`).toBe(
          can(role, capability),
        );
      }
    }
  });
});

describe("isStaffRole", () => {
  it("accepts every declared role", () => {
    for (const role of STAFF_ROLES) expect(isStaffRole(role)).toBe(true);
  });

  it("refuses anything else, including the shapes a form can send", () => {
    // The role arrives from a `<select>` in the roster UI, so the hostile
    // values are whatever someone can put in a form body.
    for (const value of ["", "OWNER", "root", "admin ", null, undefined, 0, {}, []]) {
      expect(isStaffRole(value), JSON.stringify(value)).toBe(false);
    }
  });
});
