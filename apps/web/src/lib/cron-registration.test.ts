import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every cron route has a schedule, and every schedule has a route.
 *
 * Both halves fail silently, which is the only reason this file is worth
 * having. A route with no entry in `vercel.json` is a job that was written,
 * reviewed, merged and never once ran -- it has no error, no log line and no
 * failing request, because nothing ever asks it to do anything. An entry with
 * no route is the same absence wearing a schedule: Vercel calls it, Next
 * answers 404, and the dashboard records a cron that fired.
 *
 * The membership fee sweep is what prompted it. Its whole job is to correct a
 * number nobody can see -- Sailo's cut, deducted inside a Stripe payout -- so
 * an unscheduled sweep would look exactly like a fleet that is already in
 * step. There is no observation that separates the two.
 */

const ROUTES = join(process.cwd(), "src/app/api/cron");

const routeNames = readdirSync(ROUTES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted();

const crons: { path: string; schedule: string }[] = JSON.parse(
  readFileSync(join(process.cwd(), "vercel.json"), "utf8"),
).crons;

const scheduledNames = crons
  .filter((cron) => cron.path.startsWith("/api/cron/"))
  .map((cron) => cron.path.slice("/api/cron/".length))
  .toSorted();

describe("cron routes and their schedules", () => {
  it("finds the routes at all", () => {
    // Guards the guard: a moved directory would otherwise pass both sides empty.
    expect(routeNames.length).toBeGreaterThan(5);
  });

  it("schedules every route", () => {
    const unscheduled = routeNames.filter((name) => !scheduledNames.includes(name));
    expect(unscheduled).toEqual([]);
  });

  it("has a route behind every schedule", () => {
    const missing = scheduledNames.filter((name) => !routeNames.includes(name));
    expect(missing).toEqual([]);
  });

  it("gives each route exactly one schedule", () => {
    /*
     * Two entries for one path is not additive -- it is the same job run twice
     * on two clocks, which for anything claim-free means duplicate work.
     */
    const seen = new Set<string>();
    const duplicated = scheduledNames.filter((name) => !seen.add(name));
    expect(duplicated).toEqual([]);
  });

  it("exports a GET handler from every route", () => {
    /*
     * Vercel invokes a cron with GET. A route that exports only POST is
     * reachable, schedulable, and answers 405 for ever.
     */
    for (const name of routeNames) {
      const source = readFileSync(join(ROUTES, name, "route.ts"), "utf8");
      expect(`${name}: ${source.includes("export async function GET")}`).toBe(
        `${name}: true`,
      );
    }
  });
});
