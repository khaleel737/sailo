import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The routes that answer on both origins must answer the same.
 *
 * WHY THIS TEST EXISTS
 *
 * Thirteen route paths exist in both `apps/web` and `apps/api`, and that is
 * deliberate: `/api/v1/*`, `/api/mcp` and `/api/resend/webhook` are addressed by
 * configuration we do not control — integrators' scripts, whatever assistant a
 * seller connected, the Resend dashboard — so they cannot move in one deploy
 * without a window where they answer nowhere. `docs/api-cutover.md` records the
 * order they get switched in.
 *
 * The cost of that is a duplicate, and the risk is not that somebody copies a file
 * wrong. It is that six months from now a query parameter is added to the web copy,
 * shipped, and the API origin quietly keeps answering the old contract — to a
 * caller who has no way to know which origin they reached.
 *
 * Nothing in a type system catches that. Both files compile; both routes work; they
 * just disagree. So this walks the two trees and compares what each mount actually
 * does, ignoring comments and whitespace — because the API copies carry a header
 * explaining the dual mount, which is exactly the difference that should be allowed.
 *
 * WHAT MAKES A FAILURE HERE THE RIGHT ANSWER
 *
 * If a mount genuinely needs to differ, it goes in `DELIBERATELY_DIFFERENT` with a
 * reason. That list is one line long today and every entry is an argument somebody
 * had to write down.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROUTES = join(HERE, "app/api");
const WEB_ROUTES = join(HERE, "../../web/src/app/api");

/**
 * The one path that is two different routes wearing one URL.
 *
 * Web's upload takes a session cookie from a browser; the API's takes the bearer
 * token the phone holds. Same job, different credential, and neither can serve the
 * other's caller — so this is two correct routes, not a duplicate. `docs/api-cutover.md`
 * says the same thing in the table of what never moves.
 */
const DELIBERATELY_DIFFERENT = new Set(["upload/route.ts"]);

/** Every `route.ts` under a directory, as paths relative to it. */
function routeFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "route.ts") out.push(relative(root, full));
    }
  };
  walk(root);
  return out.sort();
}

/**
 * The code, without the prose.
 *
 * Comments are stripped because the API mounts are *supposed* to carry an extra
 * paragraph about why they exist. Whitespace goes because a formatter disagreeing
 * with itself across two files is not a contract change.
 */
function behaviour(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\s+/g, "");
}

const shared = routeFiles(API_ROUTES).filter((path) => {
  try {
    statSync(join(WEB_ROUTES, path));
    return true;
  } catch {
    return false;
  }
});

describe("routes mounted on both origins", () => {
  /*
   * A guard that guards nothing is worse than no guard. If a refactor moves the
   * route trees, the filter above quietly matches zero files and this suite passes
   * by describing an empty set.
   */
  it("finds the dual mounts at all", () => {
    expect(shared.length).toBeGreaterThan(5);
    expect(shared).toContain("mcp/route.ts");
    expect(shared).toContain("resend/webhook/route.ts");
  });

  it.each(shared.filter((path) => !DELIBERATELY_DIFFERENT.has(path)))(
    "%s behaves identically on both origins",
    (path) => {
      const api = behaviour(readFileSync(join(API_ROUTES, path), "utf8"));
      const web = behaviour(readFileSync(join(WEB_ROUTES, path), "utf8"));

      expect(api).toBe(web);
    },
  );

  /*
   * And the exception stays an exception: if web's upload ever becomes identical to
   * the API's, the entry in `DELIBERATELY_DIFFERENT` is stale and should go, rather
   * than sit there implying a difference that no longer exists.
   */
  it("keeps the deliberate exception actually different", () => {
    for (const path of DELIBERATELY_DIFFERENT) {
      const api = behaviour(readFileSync(join(API_ROUTES, path), "utf8"));
      const web = behaviour(readFileSync(join(WEB_ROUTES, path), "utf8"));

      expect(api, `${path} is no longer different — drop it from the list`).not.toBe(web);
    }
  });
});
