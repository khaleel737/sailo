import { hostnameOf, isLocalDatabaseUrl } from "@sailo/db/local-database";

/**
 * Refuses to run against anything but a database on this machine.
 *
 * These suites write: they create shops, place orders, take stock, claim
 * invoice numbers and settle payments. Pointed at production they would do all
 * of that for real, and no amount of care afterwards undoes a claimed invoice
 * number in a sequence a tax authority expects unbroken.
 *
 * The hostname test lives in `@/lib/local-database`, shared with the driver
 * and with `check:load`, so all three agree on what "this machine" means.
 */
export function assertLocalDatabase(url = process.env.DATABASE_URL ?? ""): void {
  if (isLocalDatabaseUrl(url)) return;

  throw new Error(
    `scenario suite refused: DATABASE_URL points at ${hostnameOf(url)}, ` +
      `not this machine`,
  );
}
