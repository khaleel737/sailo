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
delete process.env.REDIS_URL;

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
  cacheLife: () => {},
  cacheTag: () => {},
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.1" }),
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));
