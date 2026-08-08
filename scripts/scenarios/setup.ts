/*
 * Point the app's own Neon driver at the throwaway database.
 *
 * `neonConfig.fetchEndpoint` is what makes `@neondatabase/serverless` — which
 * speaks Neon's HTTP protocol, not the Postgres wire protocol — talk to a
 * local proxy in front of an ordinary Postgres container. Without it these
 * tests could only run against a real Neon instance, and the only one
 * configured is production's.
 */
import { neonConfig } from "@neondatabase/serverless";
import type * as nextServer from "next/server";
import { vi } from "vitest";

const PROXY = process.env.SCENARIO_PROXY ?? "http://localhost:54330/sql";

neonConfig.fetchEndpoint = PROXY;
neonConfig.useSecureWebSocket = false;
neonConfig.poolQueryViaFetch = true;

process.env.DATABASE_URL =
  process.env.SCENARIO_DATABASE_URL ?? "postgres://sailo:sailo@localhost:55432/sailo";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
// No replica, so every read in these tests hits the one database they seeded.
delete process.env.READ_REPLICA_URL;
delete process.env.DATABASE_URL_REPLICA;
// Nothing here should send mail or reach Stripe.
delete process.env.RESEND_API_KEY;

/*
 * No limiter by default: without a backend `rateLimit` fails open, which keeps
 * these suites about the money path rather than about ceilings, and stops them
 * needing a second container to run.
 *
 * `SCENARIO_REDIS_URL` opts in, for the suites whose subject *is* a ceiling —
 * where failing open means the test passes without exercising anything, which
 * is worse than not having it. Deliberately a separate variable, so pointing
 * these at a real Redis stays a thing someone chose rather than something
 * `.env.local` does to them.
 *
 * Set it for one file at a time. The rest place dozens of orders a minute from
 * a single address, well past what `createOrderIntent` allows, so a live
 * limiter fails them — correctly, which is the confusing part.
 */
if (process.env.SCENARIO_REDIS_URL) {
  process.env.REDIS_URL = process.env.SCENARIO_REDIS_URL;
} else {
  delete process.env.REDIS_URL;
}

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
  cacheLife: () => {},
  cacheTag: () => {},
}));

/*
 * `after()` schedules work for once the response has gone, so it only exists
 * inside a request — and these suites call the server actions directly. Run
 * inline here: the tests want the effect to have happened by the time they
 * assert, which is the opposite of what `after` is for in production but is
 * exactly what makes it observable in a test.
 */
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof nextServer>()),
  after: (fn: (() => unknown) | Promise<unknown>) =>
    typeof fn === "function" ? void fn() : void fn,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.1" }),
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));
