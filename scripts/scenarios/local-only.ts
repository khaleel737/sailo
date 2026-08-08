/**
 * Refuses to run against anything but a database on this machine.
 *
 * These suites write: they create shops, place orders, take stock, claim
 * invoice numbers and settle payments. Pointed at production they would do all
 * of that for real, and no amount of care afterwards undoes a claimed invoice
 * number in a sequence a tax authority expects unbroken.
 *
 * The hostname is parsed rather than matched as a substring. `url.includes(
 * "localhost")` is true for `postgres://user@localhost.attacker.example/db`
 * and for any connection string with the word anywhere in it — a guard someone
 * else can register a domain to walk past is not a guard.
 */
export function assertLocalDatabase(url = process.env.DATABASE_URL ?? ""): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(
      "scenario suite refused: DATABASE_URL is not a URL it can check",
    );
  }

  if (host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]") {
    throw new Error(
      `scenario suite refused: DATABASE_URL points at ${host}, not this machine`,
    );
  }
}
