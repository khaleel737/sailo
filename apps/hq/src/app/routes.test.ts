import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every link in this app points at a route this app serves.
 *
 * Two failures this pins, both of which shipped and both of which were only
 * found by a person clicking something.
 *
 * THE `/hq` PREFIX. This panel used to live at `/hq` inside apps/web. When it
 * moved it became the root of its own deployment, so every path lost that
 * segment — and a first pass rewrote the ones in double and single quotes and
 * missed all thirty-seven written as template literals, because those are the
 * ones carrying an id. So the pages loaded and every link *out* of them 404ed:
 * `/hq/accounts/npf…` on a host whose accounts live at `/accounts/npf…`.
 * `revalidatePath` calls had the same prefix and silently refreshed nothing.
 *
 * THE OTHER DEPLOYMENT. `/admin` is apps/web's. A bare `/admin` here resolves
 * against hq.sailo.store and 404s; reaching it needs an absolute URL. The same
 * goes for any other path this app does not serve.
 *
 * Asserted against the source rather than by rendering, because the failure is
 * a *string* — it type-checks, it builds, it renders, and it is wrong only when
 * somebody clicks it.
 */

const APP = join(import.meta.dirname);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(entry) && !entry.endsWith(".test.ts") ? [path] : [];
  });
}

const sources = walk(join(APP, "..")).map((path) => ({
  path,
  code: readFileSync(path, "utf8"),
}));

/** The file with its block and line comments removed — prose may say "/hq". */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every route this app actually serves, from the filesystem. */
const routes = new Set(
  walk(join(APP))
    .filter((p) => /\/(page|route)\.tsx?$/.test(p))
    .map((p) =>
      p
        .slice(APP.length)
        .replace(/\/(page|route)\.tsx?$/, "")
        .replace(/\/\([^)]+\)/g, "")
        .replace(/^$/, "/"),
    ),
);

describe("routes this app links to", () => {
  it("never carries the old /hq prefix", () => {
    const offenders = sources
      .filter(({ code: c }) => /["'`]\/hq(\/|["'`])/.test(code(c)))
      .map(({ path }) => path.slice(APP.length));

    expect(offenders).toEqual([]);
  });

  /*
   * Static paths only. A template literal with an id in it cannot be resolved
   * here, and the prefix check above is what covers those.
   */
  it("only names paths this deployment serves", () => {
    const unknown = new Set<string>();

    for (const { code: c } of sources) {
      for (const match of code(c).matchAll(/(?:href|action)=["'](\/[a-z0-9/-]*)["']/g)) {
        const path = match[1];
        if (!path) continue;
        const segment = "/" + (path.split("/")[1] ?? "");
        const known =
          routes.has(path) ||
          [...routes].some((r) => r === segment || r.startsWith(segment + "/"));
        if (!known) unknown.add(path);
      }
    }

    expect([...unknown]).toEqual([]);
  });
});
