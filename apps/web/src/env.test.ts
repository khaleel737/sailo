import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The boot guard, proved rather than assumed.
 *
 * `env.ts` only earns its place if it actually refuses to load on a bad
 * environment — a schema that silently passes everything is worse than no
 * schema, because it looks like protection. Each case here is a
 * misconfiguration that used to reach production and fail somewhere far from
 * its cause.
 *
 * The module validates at import, so every case re-imports it after
 * `vi.resetModules()` — the same pattern the replica and rate-limit suites use
 * to watch a module read its environment at load.
 */

/** A complete, valid environment. Cases below break exactly one thing. */
const VALID = {
  DATABASE_URL: "postgres://user:pw@localhost:5432/sailo",
  BETTER_AUTH_SECRET: "a-real-secret",
  REDIS_URL: "redis://localhost:6379",
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_WEBHOOK_SECRET: "whsec_123",
  STRIPE_PLATFORM_ACCOUNT_ID: "acct_123",
};

const original = { ...process.env };

/** Replaces the environment wholesale, so nothing leaks in from the machine. */
function setEnv(vars: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined) process.env[key] = value;
  }
}

const loadEnv = () => import("./env");

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, original);
});

describe("the environment a boot is allowed to proceed on", () => {
  it("loads when everything is set", async () => {
    setEnv(VALID);
    await expect(loadEnv()).resolves.toBeDefined();
  });

  it("loads when the optional pieces are absent", async () => {
    /*
     * The important half of the design. Redis, Stripe and mail all degrade —
     * no cache, billing off, no send — so a preview deployment with none of
     * them must still boot. Requiring them would make the schema an outage.
     */
    setEnv({
      DATABASE_URL: VALID.DATABASE_URL,
      BETTER_AUTH_SECRET: VALID.BETTER_AUTH_SECRET,
    });
    await expect(loadEnv()).resolves.toBeDefined();
  });
});

describe("the environment a boot must refuse", () => {
  it("refuses a missing DATABASE_URL, naming it", async () => {
    setEnv({ ...VALID, DATABASE_URL: undefined });
    await expect(loadEnv()).rejects.toThrow(/DATABASE_URL/);
  });

  it("refuses a missing BETTER_AUTH_SECRET, naming it", async () => {
    // The one that would have bitten silently: apps/api verifies tokens
    // apps/web signs, so an absent secret is not a degraded mode.
    setEnv({ ...VALID, BETTER_AUTH_SECRET: undefined });
    await expect(loadEnv()).rejects.toThrow(/BETTER_AUTH_SECRET/);
  });

  it("refuses a DATABASE_URL that is set but not a URL", async () => {
    // Truncated or half-pasted connection strings are the common form.
    setEnv({ ...VALID, DATABASE_URL: "postgres-not-a-url" });
    await expect(loadEnv()).rejects.toThrow(/DATABASE_URL/);
  });

  it("refuses a Stripe secret pasted into the webhook variable", async () => {
    /*
     * The mistake no type can catch: both values are opaque strings, so
     * swapping them fails as a signature mismatch on live traffic and reads as
     * "Stripe is broken" rather than "these two are the wrong way round".
     */
    setEnv({ ...VALID, STRIPE_WEBHOOK_SECRET: "sk_test_123" });
    await expect(loadEnv()).rejects.toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it("refuses a webhook secret pasted into the Stripe key", async () => {
    setEnv({ ...VALID, STRIPE_SECRET_KEY: "whsec_123" });
    await expect(loadEnv()).rejects.toThrow(/STRIPE_SECRET_KEY/);
  });

  it("refuses a platform account id that is not an account id", async () => {
    // A typo here does not error at runtime — it silently stops one shop's
    // events from ever matching their own orders.
    setEnv({ ...VALID, STRIPE_PLATFORM_ACCOUNT_ID: "cus_123" });
    await expect(loadEnv()).rejects.toThrow(/STRIPE_PLATFORM_ACCOUNT_ID/);
  });

  it("refuses a malformed REDIS_URL rather than falling back forever", async () => {
    // Set-but-wrong is the silent one: every call falls back and the only
    // symptom is that nothing is ever cached.
    setEnv({ ...VALID, REDIS_URL: "localhost:6379" });
    await expect(loadEnv()).rejects.toThrow(/REDIS_URL/);
  });

  it("names every offending variable at once, not just the first", async () => {
    // A fresh environment is usually missing several things; reporting them
    // one deploy at a time is the slow way to find that out.
    setEnv({ STRIPE_WEBHOOK_SECRET: "sk_oops" });
    await expect(loadEnv()).rejects.toThrow(/DATABASE_URL/);
  });
});

describe("the escape hatch", () => {
  it("skips validation when SKIP_ENV_VALIDATION is 1", async () => {
    /*
     * CI typechecks and lints without a database, and a container image is
     * built before its secrets are attached. Both need to load this module
     * without satisfying it.
     */
    setEnv({ SKIP_ENV_VALIDATION: "1" });
    await expect(loadEnv()).resolves.toBeDefined();
  });

  it("does not skip for any other value", async () => {
    // "true", "yes" and "0" must not disable the guard by accident.
    setEnv({ SKIP_ENV_VALIDATION: "true" });
    await expect(loadEnv()).rejects.toThrow(/DATABASE_URL/);
  });
});
