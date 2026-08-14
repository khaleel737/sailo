import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { RESERVED_HANDLES, validateHandleFormat } from "@sailo/core/handle";

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
      .filter((name) => !name.startsWith("[") && !name.startsWith("_"));

    expect(routes.length).toBeGreaterThan(5);
    for (const route of routes) {
      expect(
        RESERVED_HANDLES.has(route) || validateHandleFormat(route) !== null,
        `/${route} is a live route but claimable as a handle`,
      ).toBe(true);
    }
  });
});
