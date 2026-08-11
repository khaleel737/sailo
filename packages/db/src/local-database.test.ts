import { describe, expect, it } from "vitest";
import { hostnameOf, isLocalDatabaseUrl, localHostname } from "./local-database";

/**
 * The predicate three callers trust before writing.
 *
 * Two of them refuse to run when it says no — a scenario suite that places
 * real orders, and a load generator that writes hundreds of thousands of rows.
 * A false positive here is those safeguards opening onto production, so the
 * interesting cases are the strings that look local and are not.
 */
describe("isLocalDatabaseUrl", () => {
  it("accepts the three loopback forms", () => {
    expect(isLocalDatabaseUrl("postgres://u:p@localhost:5432/db")).toBe(true);
    expect(isLocalDatabaseUrl("postgres://u:p@127.0.0.1:5432/db")).toBe(true);
    expect(isLocalDatabaseUrl("postgres://u:p@[::1]:5432/db")).toBe(true);
  });

  it("rejects a host that merely contains a loopback name", () => {
    // The reason this parses rather than matching substrings: the domain on
    // the right of the @ is the one that gets connected to, and anyone can
    // register a name with "localhost" in it.
    expect(isLocalDatabaseUrl("postgres://u:p@localhost.attacker.example/db")).toBe(false);
    expect(isLocalDatabaseUrl("postgres://u:p@notlocalhost/db")).toBe(false);
    expect(isLocalDatabaseUrl("postgres://u:p@evil.com/localhost")).toBe(false);
    // The credentials are attacker-controlled too, in a copied connection string.
    expect(isLocalDatabaseUrl("postgres://localhost:127.0.0.1@neon.tech/db")).toBe(false);
  });

  it("rejects a real database host", () => {
    expect(
      isLocalDatabaseUrl("postgres://u:p@ep-cool-name-123456-pooler.eu-central-1.aws.neon.tech/db"),
    ).toBe(false);
  });

  it("rejects anything it cannot parse, rather than guessing", () => {
    // A connection string we cannot read is not one we can vouch for, and the
    // callers here are deciding whether it is safe to write.
    expect(isLocalDatabaseUrl("")).toBe(false);
    expect(isLocalDatabaseUrl("not a url")).toBe(false);
    expect(isLocalDatabaseUrl("localhost:5432")).toBe(false);
  });

  it("reports the host it matched, so a refusal can name it", () => {
    expect(localHostname("postgres://u:p@[::1]:5432/db")).toBe("[::1]");
    expect(localHostname("postgres://u:p@neon.tech/db")).toBeNull();
    expect(hostnameOf("postgres://u:p@neon.tech/db")).toBe("neon.tech");
    expect(hostnameOf("garbage")).toBe("an unparseable URL");
  });
});
