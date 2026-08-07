import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * The replica is a correctness boundary, not a performance setting.
 *
 * A Neon read replica lags the primary — usually milliseconds, occasionally
 * much more, with no bound you can rely on. Every rule below exists because
 * breaking it does not fail loudly: the code runs, the query returns rows, and
 * the rows are from slightly before the write that was about to be checked
 * against them. Stock is sold twice, a webhook re-runs work it already did, a
 * revoked session is still valid. None of that shows up in a test that only
 * asks whether the page rendered.
 *
 * So these are structural: they read the source and assert which modules are
 * allowed to touch the replica at all.
 */

const files = (dir: string) =>
  execSync(`grep -rl "getReadDb" ${dir} --include='*.ts' || true`, {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);

/**
 * Modules whose answers decide whether a write happens. A stale read here is
 * a bug with money or authorisation attached, so they must use the primary.
 */
const PRIMARY_ONLY = [
  // Stock. A stale count is how two buyers are sold the last one.
  "src/lib/inventory.ts",
  // Everything on the way to creating an order.
  "src/lib/actions/orders.ts",
  "src/lib/orders/coupon-redemption.ts",
  "src/lib/orders/card-handoff.ts",
  // Settlement, whose idempotency depends on seeing its own last write.
  "src/lib/stripe-webhooks.ts",
  "src/lib/actions/order-admin.ts",
  // Sessions and the staff allowlist. A revoked session a replica has not
  // heard about yet is an authorisation hole.
  "src/lib/session.ts",
];

describe("read replica", () => {
  it("falls back to the primary when no replica is configured", () => {
    /*
     * The deploy order matters: this ships before the replica exists, and
     * rolling back is deleting one environment variable. Neither may take the
     * site down, so an unset `DATABASE_URL_REPLICA` has to mean "use the
     * primary" rather than "throw".
     */
    const source = readFileSync("src/db/index.ts", "utf8");
    expect(source).toContain("if (!url) return getDb();");
  });

  it("never reads a write path from the replica", () => {
    for (const path of PRIMARY_ONLY) {
      let source: string;
      try {
        source = readFileSync(path, "utf8");
      } catch {
        // The module was renamed. That is worth knowing about, because this
        // list is the only thing recording why it must stay on the primary.
        throw new Error(`${path} no longer exists — update PRIMARY_ONLY`);
      }
      expect(source, `${path} must read the primary`).not.toContain("getReadDb");
    }
  });

  it("keeps the replica to reporting", () => {
    /*
     * Not a blanket ban on new callers — an allowlist, so adding one is a
     * deliberate act that comes with reading the rules in `db/index.ts`.
     */
    const allowed = new Set([
      "src/lib/queries/analytics.ts",
      "src/lib/hq/exports.ts",
      "src/db/index.ts",
    ]);
    const actual = files("src").filter((f) => !f.endsWith(".test.ts"));
    expect(actual.toSorted()).toEqual([...allowed].toSorted());
  });

  it("does not let a replica read reach a Server Action", () => {
    // Actions mutate. Any read inside one is a read a write depends on.
    for (const file of files("src/lib/actions")) {
      expect(file, `${file} is a Server Action module`).toBe("");
    }
  });
});
