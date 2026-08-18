import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { RESERVED_HANDLES, normalizeHandle, validateHandleFormat } from "@sailo/core/handle";

/**
 * The half of the handle rules that could not leave this app.
 *
 * `handle.ts` moved to `@sailo/core` so `packages/api` can validate a handle
 * for the mobile sign-up flow, and its unit tests went with it. This one did
 * not: it reads `src/app` off disk, and the whole assertion is about *this
 * app's* route tree. In `packages/core` there is no `src/app` to read, so the
 * test would have had to either invent a path back across the package boundary
 * or be deleted — and deleting it is how the bug it was written for comes back.
 *
 * Kept here, importing the list from the package. The rule is unchanged; only
 * the side of the boundary it is asserted from has moved.
 */

describe("reserved handles", () => {
  it("reserves every route the app actually serves at the root", () => {
    /*
     * Read off disk rather than typed here, because typing it here is what
     * went wrong: seven live routes — `/partner`, `/download`, `/gdpr`,
     * `/forgot-password`, `/reset-password`, `/dev` and the rest — were absent
     * from the list while being real pages.
     *
     * A static segment always beats `[handle]`, so claiming one of those was
     * not an escalation: it was a seller whose shop silently never rendered,
     * at a handle that had validated and saved, with nothing to tell them why.
     * This fails the moment a new top-level route is added without a decision
     * about the name.
     */
    const appDir = join(process.cwd(), "src/app");
    const routes = readdirSync(appDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .flatMap((e) =>
        // A route group is not a URL segment; its children are.
        e.name.startsWith("(")
          ? readdirSync(join(appDir, e.name), { withFileTypes: true })
              .filter((c) => c.isDirectory())
              .map((c) => c.name)
          : [e.name],
      )
      // `[handle]` is the catch-all this list exists to protect, and `_`-
      // prefixed folders are private and serve nothing.
      .filter((name) => !name.startsWith("[") && !name.startsWith("_"))
      /*
       * A segment a handle could never spell cannot be shadowed by one.
       *
       * `/llms.txt` and `/llms-full.txt` are the case: `normalizeHandle` strips
       * everything outside `[a-z0-9_-]`, and `actions/shop.ts` normalises
       * before it stores, so a seller who types `llms.txt` gets the handle
       * `llmstxt` and a shop at a URL that collides with nothing. Adding those
       * names to `RESERVED_HANDLES` to satisfy this loop would put two entries
       * on the list that no input can ever produce — which is exactly what
       * `handle.test.ts` fails on, and rightly: a reserved name nobody can type
       * is not protection, it is a line that reads like protection.
       *
       * Dropped here rather than special-cased, so the next route with a dot in
       * it is covered by the reasoning instead of by another exception.
       */
      .filter((name) => normalizeHandle(name) === name);

    expect(routes.length).toBeGreaterThan(5);
    for (const route of routes) {
      expect(
        RESERVED_HANDLES.has(route) || validateHandleFormat(route) !== null,
        `/${route} is a live route but claimable as a handle`,
      ).toBe(true);
    }
  });
});
