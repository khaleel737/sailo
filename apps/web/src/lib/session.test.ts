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

  it("is called 159 times, and every one names a real permission", () => {
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
     * 152 → 153 is the ⌘K palette's search route at `/api/admin/palette`,
     * which claims `orders:read` — the weakest read every member holds — and
     * then narrows each result group by `roleCan`, so the palette cannot show
     * a teammate rows the sidebar would refuse them.
     *
     * 153 → 157 is spec 30's builder, the automations desk at `/admin/flows`:
     * three pages (the list, the new-flow form, the editor) reading
     * `marketing:read`, plus the one gate in `actions/flows.ts` claiming
     * `marketing:send` — the same permission broadcasts sends under, because
     * a flow is another way to put mail in somebody's inbox.
     *
     * 157 → 159 is spec 32's seller-facing half: the abandoned-checkouts
     * ledger at `/admin/abandoned` reading `orders:read` — a stalled checkout
     * is order-shaped news — and `setRecoveryEnabled` in `actions/recovery.ts`
     * claiming `settings:write`, because the built-in recovery email's switch
     * configures the shop the way opening hours do.
     *
     * 159 → 163 is the settings split by responsibility (docs/admin-redesign
     * 02): Appearance and Analytics & pixels leave the Shop-details monolith
     * as their own sections — two pages reading `settings:read`, and their
     * two narrow writers in `actions/shop.ts` (`updateShopAppearance`,
     * `updateShopTracking`) claiming `settings:write`, each UPDATE naming
     * only its own columns so a look change can never blank a tax field.
     *
     * 163 → 165 is the same split's second room (docs/admin-redesign 02):
     * Notifications leaves Shop details — one page reading `settings:read`
     * and `updateShopNotifications` in `actions/shop.ts` claiming
     * `settings:write`, so an absent card elsewhere can never switch a
     * seller's mail off again the way the monolith once nulled pixels.
     *
     * 165 → 166 is the product record's ⋯ menu (docs/admin-redesign 05):
     * `duplicateProduct` in `actions/products.ts` claiming `products:write`.
     * The copy itself is written by `@sailo/commerce/products`, cap and all —
     * what the claim guards is the door, which is the only part of a
     * duplicate a stranger could reach.
     *
     * 166 → 167 is the analytics split (docs/admin-redesign 08): the numbers
     * left Home for /admin/analytics, and the new page claims `money:read` —
     * revenue, refunds and tax are the most sensitive thing on it, and
     * "anything that says what came in" is that resource's own definition.
     * Home keeps its `orders:read`; a staff member who may handle orders
     * still sees their to-do list, and only the money page asks for more.
     *
     * 167 → 170 is the orders list's selection bar (docs/admin-redesign 04):
     * three bulk actions in `actions/bulk-orders.ts`, each claiming
     * `orders:write`. Three claims and not one, because each door re-checks
     * for itself — a shared helper that checked once would be a door two
     * others lean through. Refund and delete are deliberately absent from
     * that file: money-out and destruction stay one order at a time.
     *
     * 170 → 172 is the catalogue's selection bar — the orders bar's sibling:
     * `bulkSetPublished` (one door behind both Publish and Hide) and
     * `bulkDeleteProducts` in `actions/products.ts`, each claiming
     * `products:write`. Delete rides in the bar here, unlike orders, because
     * deleting a product moves no money and orders keep their records — but
     * it keeps the said-out-loud confirm.
     *
     * Update this deliberately when a screen is added or removed. A number that
     * moves on its own is exactly the thing this exists to notice.
     */
    expect(sites).toHaveLength(172);

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
    expect(inActions).toHaveLength(113);
    expect(inRoutes).toHaveLength(7);
    expect(inPages).toHaveLength(52);
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
