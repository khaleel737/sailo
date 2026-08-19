import { vi } from "vitest";
import type * as nextCache from "next/cache";

/**
 * A deterministic environment, identical here and in CI.
 *
 * This used to be `config({ path: ".env.local" })`, and that one line was the
 * cause of every "passes locally, fails on Vercel" failure in this suite. It
 * did two things, both bad:
 *
 * **It made the suite depend on a file CI does not have.** `@/lib/auth` calls
 * `getDb()` while the module loads, so `auth-messages.test.ts` needs a
 * `DATABASE_URL` to exist at import time. Locally one did; on a clean checkout
 * the suite failed to load at all. The same shape broke `replica.test.ts`, and
 * `markup.test.ts` was failing on the mirror image of it — an assertion that
 * read whatever hostname the deploy happened to have.
 *
 * **And `.env.local` is production.** It carries the live Neon URL, the live
 * Stripe key and the live Resend key. A unit test process had all three, so the
 * only thing standing between a stray `getDb()` in a test and the database
 * taking real orders was that nobody had written one yet. The scenario suites
 * refuse a non-local database on purpose (`e2e/scenarios/local-only.ts`); the
 * unit suite quietly had the opposite arrangement.
 *
 * So: explicit fakes, set before anything imports. A unit test that genuinely
 * needs a database belongs in the scenario suite, which has a guard.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/sailo_unit";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ??= "unit-tests-only-not-a-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

/*
 * Removed rather than defaulted. A replica URL changes which connection a read
 * takes, and `replica.test.ts` stubs these per case — a value inherited from a
 * developer's shell would make that test assert about their machine.
 */
delete process.env.READ_REPLICA_URL;
delete process.env.DATABASE_URL_REPLICA;

/*
 * Nothing in a unit test may reach a provider. Their absence is what makes the
 * mail and payment seams return their "not configured" branches, which is the
 * behaviour these tests are written against.
 */
delete process.env.RESEND_API_KEY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.REDIS_URL;

/*
 * `cacheLife()` and `cacheTag()` refuse to run unless Next's `cacheComponents`
 * flag is on, and vitest does not load `next.config.ts`. They are build-time
 * declarations with no behaviour a unit test could assert, so they become
 * no-ops here — the alternative is every module that caches a read being
 * untestable, which is most of them.
 *
 * `use cache` itself needs no stub: it is a directive the bundler acts on, and
 * an ordinary function call under vitest.
 */
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof nextCache>()),
  cacheLife: () => {},
  cacheTag: () => {},
}));
