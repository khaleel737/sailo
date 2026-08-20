import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHOP_PERMISSIONS } from "@sailo/auth/permissions";

/**
 * The audit, pinned — spec 37.
 *
 * > **Count the call sites and write the number down.** `PRODUCTION-PLAN.md`
 * > did exactly that for 32 actions and 20 HQ queries, and that number is what
 * > lets the next person verify the audit was complete rather than plausible.
 *
 * The number is here rather than only in a commit message, because a commit
 * message cannot fail. `requireShop` takes a required permission, so a *new*
 * call site cannot compile without one — what this adds is the second half:
 * the count moving is visible in a diff, so "we added a screen" and "somebody
 * quietly removed a guard" stop looking the same.
 *
 * There is a precedent in this tree for what enforced means: every HQ write
 * names a `StaffCapability`, and a bare `requireStaff()` was the hole that
 * shipped once.
 */

const SHOP = "src/lib/session.ts";

/** Every `requireShop("…")` in the app, as `file:line → permission`. */
function callSites(): { file: string; permission: string }[] {
  const out = execSync(
    `grep -rn 'requireShop("' src --include='*.ts' --include='*.tsx' || true`,
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  return out
    .split("\n")
    .filter(Boolean)
    // This file talks *about* the calls; it does not make any.
    .filter((line) => !line.startsWith(`${__filename.split("/").pop()}`) && !line.includes("session.test.ts"))
    .flatMap((line) => {
      const file = line.slice(0, line.indexOf(":"));
      // A line can hold only one call in practice, but read them all rather
      // than assume it.
      return [...line.matchAll(/requireShop\("([^"]+)"\)/g)].map((m) => ({
        file,
        permission: m[1]!,
      }));
    });
}

describe("requireShop, audited", () => {
  it("takes a required permission and does not default it", () => {
    const source = readFileSync(SHOP, "utf8");
    /*
     * The whole guarantee in one assertion. An optional parameter is a hole
     * that compiles silently across a hundred files, and a default value is the
     * same hole written differently — whichever permission were chosen would be
     * the one every un-audited call site silently claimed.
     */
    expect(source).toContain("requireShop(permission: ShopPermission)");
    expect(source).not.toMatch(/requireShop\(\s*permission[^)]*=/);
    expect(source).not.toMatch(/requireShop\(\s*permission\?/);
  });

  it("is called 152 times, and every one names a real permission", () => {
    const sites = callSites();

    /*
     * **152**, and the number is the point of this test.
     *
     * The audit that introduced the argument found **140** existing call sites
     * — 94 server actions, 40 pages and layouts, 6 route handlers — and read
     * every one of them to decide what it actually does. The team feature then
     * added seven of its own: five writes in `actions/team.ts` and the settings
     * page, all `team:*`, which no role but the owner carries.
     *
     * 147 → 149 is the order detail screen, and both of its claims are on the
     * same file: `generateMetadata` guards as well as the page body. That is
     * not a duplicate to be tidied away — Next runs the two independently, and
     * a title naming a buyer is as much of a leak as the page under it.
     *
     * 149 → 152 is spec 51's roster: `saveStaffMember` and `toggleStaffActive`
     * in `actions/staff.ts`, both `settings:write`, plus the screen they serve
     * at `/admin/settings/staff`, which reads `settings:read`. Who takes
     * bookings is shop-wide configuration in the same sense the opening hours
     * are, and `settings` is the resource a manager holds read-only.
     *
     * Update this deliberately when a screen is added or removed. A number that
     * moves on its own is exactly the thing this exists to notice.
     */
    expect(sites).toHaveLength(152);

    const unknown = sites.filter(
      (s) => !(SHOP_PERMISSIONS as readonly string[]).includes(s.permission),
    );
    expect(unknown).toEqual([]);
  });

  it("keeps the shape of the audit: mostly actions, and one refund", () => {
    const sites = callSites();
    const inActions = sites.filter((s) => s.file.startsWith("src/lib/actions/"));
    const inRoutes = sites.filter((s) => s.file.endsWith("route.ts"));
    const inPages = sites.filter(
      (s) =>
        s.file.startsWith("src/app/") &&
        (s.file.endsWith("page.tsx") || s.file.endsWith("layout.tsx")),
    );
    expect(inActions).toHaveLength(102);
    expect(inRoutes).toHaveLength(6);
    expect(inPages).toHaveLength(44);
    expect(inActions.length + inRoutes.length + inPages.length).toBe(sites.length);

    /*
     * `orders:refund` is claimed exactly once, by `refundOrder`. It is a
     * separate action from `orders:write` precisely so it can be withheld, and
     * a second claim on it would mean some other function had quietly become a
     * way to move money back out.
     */
    const refunds = sites.filter((s) => s.permission === "orders:refund");
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.file).toBe("src/lib/actions/order-admin.ts");

    // Likewise for the other withheld action.
    const exports = sites.filter((s) => s.permission === "customers:export");
    expect(exports.map((s) => s.file).sort()).toEqual([
      "src/app/api/export/[type]/route.ts",
      "src/lib/actions/data-requests.ts",
      "src/lib/actions/data-requests.ts",
    ]);
  });

  it("leaves no bare `requireShop()` anywhere", () => {
    /*
     * `await requireShop()`, which is what a call looks like — prose that
     * *mentions* the function is not one, and this file and two comments do.
     * The compiler already refuses a bare call; this is the belt for the day
     * somebody reaches for `as never` to get past it.
     */
    const bare = execSync(
      `grep -rn 'await requireShop()' src --include='*.ts' --include='*.tsx' || true`,
      { encoding: "utf8" },
    )
      .split("\n")
      .filter((line) => line && !line.includes("session.test.ts"))
      .join("\n")
      .trim();
    expect(bare).toBe("");
  });
});
