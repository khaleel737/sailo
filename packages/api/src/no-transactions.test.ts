import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The database driver is neon-http, and neon-http throws on
 * `db.transaction()` — at runtime, unconditionally, with types that compile.
 * `categories.reorder` shipped that way and every drag-reorder from the phone
 * was a 500 until it became a `db.batch()`, which is the only atomicity the
 * driver offers.
 *
 * A source scan rather than a mock, because the mistake compiles and no unit
 * test of the happy path would ever call the real driver. Same pattern as
 * apps/web's route-audit tests: read the code off disk and refuse the shape.
 */

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [path]
      : [];
  });
}

describe("neon-http has no transactions", () => {
  it("finds no db.transaction() call in this package", () => {
    const offenders = sources(join(__dirname)).filter((file) =>
      /\.transaction\s*\(/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
