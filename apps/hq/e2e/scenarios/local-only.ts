import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hostnameOf, isLocalDatabaseUrl } from "@sailo/db/local-database";

/**
 * Refuses to run against a database that is taking real orders.
 *
 * These suites write: they create shops, place orders, take stock, claim invoice
 * numbers and settle payments. Pointed at production they would do all of that
 * for real, and no amount of care afterwards undoes a claimed invoice number in
 * a sequence a tax authority expects unbroken.
 *
 * Two ways to satisfy it, and the second was added because the first is slow.
 *
 * **A database on this machine.** `e2e/scenarios/up.sh` starts one. The
 * hostname test lives in `@sailo/db/local-database`, shared with the driver and
 * with `check:load`, so all three agree on what "this machine" means.
 *
 * **An explicitly opted-in remote branch.** A Neon dev branch runs these suites
 * several times faster than a Postgres container behind an HTTP proxy, and a
 * branch is exactly as disposable as a container. It needs `SCENARIO_ALLOW_REMOTE`
 * set — so it is a decision recorded in a file rather than something a stray
 * environment variable does to you — and it must not be the database the app
 * itself is configured with.
 *
 * That last check is the one doing the real work, and it is a stronger property
 * than "must be localhost" ever was. The failure this guard exists to prevent is
 * not "wrote to a remote host", it is "wrote to the database serving customers",
 * and comparing against `.env.local` tests for that directly. A localhost URL
 * that happened to tunnel to production would have passed the old test and fails
 * this one.
 */
export function assertLocalDatabase(url = process.env.DATABASE_URL ?? ""): void {
  if (isLocalDatabaseUrl(url)) return;

  if (process.env.SCENARIO_ALLOW_REMOTE) {
    const app = appDatabaseUrl();
    if (app && sameDatabase(app, url)) {
      throw new Error(
        `scenario suite refused: SCENARIO_ALLOW_REMOTE is set, but the URL is ` +
          `the one .env.local names (${hostnameOf(url)}) — that is the database ` +
          `the app serves customers from. Point it at a branch.`,
      );
    }
    return;
  }

  throw new Error(
    `scenario suite refused: DATABASE_URL points at ${hostnameOf(url)}, ` +
      `not this machine. Run ./e2e/scenarios/up.sh, or set SCENARIO_ALLOW_REMOTE ` +
      `with a URL that is not the app's own.`,
  );
}

/**
 * What `.env.local` names, read from the file rather than from the environment.
 *
 * `setup.ts` overwrites `process.env.DATABASE_URL` before any of this runs, so
 * by the time the guard is asked, the environment no longer remembers what the
 * app is configured with — which is precisely the value being guarded against.
 */
function appDatabaseUrl(): string | null {
  try {
    const file = readFileSync(join(process.cwd(), "../../.env.local"), "utf8");
    return file.match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1] ?? null;
  } catch {
    /*
     * No `.env.local` — a CI runner, most likely. Nothing to compare against, so
     * the opt-in stands on its own. Deliberately not a refusal: a guard that
     * fails closed on a *missing* file would make the suites unrunnable anywhere
     * the app is not also configured, which is most places they should run.
     */
    return null;
  }
}

/** Same host and same database name, ignoring credentials and query string. */
function sameDatabase(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    /*
     * Neon gives every endpoint a pooled and an unpooled hostname for the same
     * database — `ep-x-pooler` and `ep-x`. Comparing them raw would call the two
     * different, so the suffix comes off before the comparison. Getting this
     * wrong means the guard waves through the app's own database under its other
     * name, which is the whole failure it exists to prevent.
     */
    const host = (url: URL) => url.hostname.replace(/-pooler\./, ".");
    return host(left) === host(right) && left.pathname === right.pathname;
  } catch {
    return false;
  }
}
