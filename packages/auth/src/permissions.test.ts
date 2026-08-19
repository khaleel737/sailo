import { describe, expect, it } from "vitest";
/** `toSorted` needs a newer lib than this package targets; sorting a copy is
 * the same guarantee without moving a compiler option for one file. */
const sorted = <T>(xs: readonly T[]) => [...xs].sort();

import {
  SHOP_PERMISSIONS,
  SHOP_ROLE_IDS,
  isShopRole,
  roleCan,
  shopAccess,
  type ShopPermission,
} from "./permissions";

/**
 * What each role grants — pinned exhaustively, because the interesting failure
 * is a role that grants *more* than it should and nothing looks wrong.
 *
 * Listing every permission for every role rather than spot-checking a few:
 * spec 37's whole point is that `refund` and `export` are withheld, and a test
 * that only asserts the positives passes just as happily when a role quietly
 * gains one.
 */

const EXPECTED: Record<string, ShopPermission[]> = {
  owner: [
    "products:read", "products:write",
    "orders:read", "orders:write", "orders:refund",
    "customers:read", "customers:write", "customers:export",
    "marketing:read", "marketing:send",
    "money:read",
    "settings:read", "settings:write",
    "team:read", "team:write",
  ],
  manager: [
    "products:read", "products:write",
    // No `orders:refund` — a refund is money leaving, and `money` is the
    // resource this role does not carry. See the role's own note.
    "orders:read", "orders:write",
    "customers:read", "customers:write", "customers:export",
    "marketing:read", "marketing:send",
    // No `money`, no `team`, and `settings` is read-only.
    "settings:read",
  ],
  staff: [
    "products:read",
    "orders:read", "orders:write",
    "customers:read", "customers:write",
  ],
};

describe("the three roles", () => {
  it("is exactly three, and the owner is one of them", () => {
    expect([...SHOP_ROLE_IDS]).toEqual(["owner", "manager", "staff"]);
    expect(isShopRole("owner")).toBe(true);
    expect(isShopRole("admin")).toBe(false);
    expect(isShopRole(null)).toBe(false);
  });

  it.each(SHOP_ROLE_IDS)("%s grants exactly what it should and nothing more", (role) => {
    const granted = SHOP_PERMISSIONS.filter((p) => roleCan(role, p));
    expect(sorted(granted)).toEqual(sorted(EXPECTED[role]!));
  });

  it("withholds the two a seller most often withholds", () => {
    // The whole reason `refund` and `export` are separate actions — and the
    // manager is withheld the refund too, which is what makes the split
    // load-bearing rather than decorative.
    expect(roleCan("manager", "orders:refund")).toBe(false);
    expect(roleCan("manager", "orders:write")).toBe(true);
    expect(roleCan("staff", "orders:refund")).toBe(false);
    expect(roleCan("staff", "customers:export")).toBe(false);
    // ...but tagging a buyer while working the queue is part of the job.
    expect(roleCan("staff", "customers:write")).toBe(true);
    expect(roleCan("staff", "orders:write")).toBe(true);
    expect(roleCan("staff", "customers:read")).toBe(true);
  });

  it("lets nobody but the owner change the shop or the team", () => {
    for (const role of ["manager", "staff"] as const) {
      expect(roleCan(role, "settings:write"), role).toBe(false);
      expect(roleCan(role, "team:write"), role).toBe(false);
      expect(roleCan(role, "money:read"), role).toBe(false);
    }
    expect(roleCan("owner", "settings:write")).toBe(true);
    expect(roleCan("owner", "team:write")).toBe(true);
    expect(roleCan("owner", "money:read")).toBe(true);
  });

  it("refuses an unknown role rather than defaulting it", () => {
    /*
     * `member.role` is a text column. A row written by a future build — or by
     * hand — must not fall through to the most permissive answer, which is
     * what a `switch` with a `default` would do.
     */
    for (const permission of SHOP_PERMISSIONS) {
      expect(roleCan("superuser", permission), permission).toBe(false);
      expect(roleCan("", permission), permission).toBe(false);
    }
  });

  it("names the same permissions the statement map does", () => {
    // The list the settings screen renders comes from the statements, so a
    // resource added to one and forgotten in the other cannot happen.
    const fromStatements = Object.entries(shopAccess.statements).flatMap(
      ([resource, actions]) => actions.map((a) => `${resource}:${a}`),
    );
    expect(sorted(SHOP_PERMISSIONS)).toEqual(sorted(fromStatements));
    expect(SHOP_PERMISSIONS).toHaveLength(15);
  });
});
