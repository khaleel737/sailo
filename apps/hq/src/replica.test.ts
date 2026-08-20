import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * The replica is a correctness boundary, not a performance setting — the
 * same rule apps/web/src/replica.test.ts enforces for the seller app,
 * scoped to this one. A Neon read replica lags the primary with no bound
 * you can rely on, and a stale read that decides a write is a bug with
 * money or authorisation attached that no rendering test can see.
 *
 * The shape of this app makes the rule simple: `lib/platform/**` informs
 * screens and exports behind `requireStaff` and owns no writes — the staff
 * actions that do write live in `lib/actions` and re-read on the primary.
 * So platform reads may use the replica, actions never may.
 */

const files = (dir: string) =>
  execSync(`grep -rl "getReadDb" ${dir} --include='*.ts' || true`, {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.endsWith(".test.ts"));

describe("read replica", () => {
  it("keeps the replica to reporting", () => {
    /*
     * An allowlist, not a ban on new callers: adding a file here is a
     * deliberate act that comes with reading the rules in `db/index.ts`.
     * `partners.ts` is absent on purpose — it mixes reads with two writes,
     * and a module that writes stays whole on the primary rather than
     * hand-sorting its queries into two connections.
     */
    const allowed = new Set([
      "src/lib/platform/accounts.ts",
      "src/lib/platform/disputes.ts",
      "src/lib/platform/exports.ts",
      "src/lib/platform/lists.ts",
      "src/lib/platform/overview.ts",
      "src/lib/platform/payments.ts",
      "src/lib/platform/risk.ts",
      "src/lib/platform/security/sessions.ts",
      "src/lib/platform/subscriptions.ts",
    ]);
    expect(files("src").toSorted()).toEqual([...allowed].toSorted());
  });

  it("does not let a replica read reach a staff action", () => {
    // Actions mutate. Any read inside one is a read a write depends on.
    for (const file of files("src/lib/actions")) {
      expect(file, `${file} is a staff action module`).toBe("");
    }
  });
});
