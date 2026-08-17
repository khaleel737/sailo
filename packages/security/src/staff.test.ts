import { afterEach, describe, expect, it } from "vitest";
import { isStaffEmail, refusesPasswordAuth, staffEmails } from "./staff";

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
