import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertLocalDatabase } from "./local-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  member,
  orders,
  organization,
  session,
  shopMemberActions,
  shops,
  user,
} from "@sailo/db/schema";
import { ensureShopOrganization } from "@sailo/auth/organization-for-shop";
import { roleCan } from "@sailo/auth/permissions";

/**
 * Spec 37's guard, against real rows.
 *
 * `requireShop` is the whole risk of this feature and it is the one thing a
 * unit test cannot reach: it resolves a shop *through membership*, refuses on a
 * role read from the database, and is the only thing standing between a staff
 * member and a refund button. So the session is faked and everything else is
 * real — the member rows, the roles, the guard, and the actions behind it.
 *
 * Run with:
 *   npx dotenv -e .env.local.test -- \
 *     npx vitest run --config vitest.scenarios.mts e2e/scenarios/team.scenario.ts
 */

const db = getDb();
const uid = () => crypto.randomUUID();

/** Whoever is "signed in" for the next call. */
const signedIn = vi.hoisted(() => ({ id: "", email: "" }));

vi.mock("@/lib/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...real,
    auth: {
      ...real.auth,
      api: {
        ...real.auth.api,
        getSession: async () =>
          signedIn.id
            ? { user: { id: signedIn.id, email: signedIn.email, emailVerified: true } }
            : null,
      },
    },
  };
});

const { requireShop } = await import("@/lib/session");
const { refundOrder, updateOrderStatus } = await import("@/lib/actions/order-admin");
const { changeTeamRole, recordMemberAction, removeTeamMember } = await import(
  "@/lib/actions/team"
);

beforeAll(() => {
  assertLocalDatabase();
});

beforeEach(() => {
  signedIn.id = "";
  signedIn.email = "";
});

async function makeUser(label: string) {
  const id = uid();
  const email = `${label}-${id.slice(0, 8)}@example.com`;
  await db.insert(user).values({
    id,
    name: label,
    email,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { id, email };
}

async function makeShopWithTeam() {
  const owner = await makeUser("owner");
  const [shop] = await db
    .insert(shops)
    .values({
      userId: owner.id,
      handle: `team-${owner.id.slice(0, 8)}`,
      name: "Team Shop",
      currency: "USD",
      isPublished: true,
      plan: "business",
      subscriptionStatus: "active",
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");

  const organizationId = await ensureShopOrganization(shop.id);
  if (!organizationId) throw new Error("fixture: no organization");

  return { shop, owner, organizationId };
}

async function addMember(organizationId: string, userId: string, role: string) {
  const [row] = await db
    .insert(member)
    .values({ id: uid(), organizationId, userId, role, createdAt: new Date() })
    .returning();
  return row!;
}

/** Runs a guard as somebody, returning either the value or its redirect. */
async function as<T>(
  who: { id: string; email: string },
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; to: string }> {
  signedIn.id = who.id;
  signedIn.email = who.email;
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    /*
     * `redirect()` throws. Catching it and reading the destination is how a
     * refusal is asserted without a browser — and it also proves the refusal is
     * a *refusal* rather than a thrown 500, which is the failure spec 37's
     * browser test is written against.
     */
    const digest = (error as { digest?: string }).digest ?? "";
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
      return { ok: false, to: digest };
    }
    throw error;
  }
}

describe("a shop's own organization", () => {
  it("is created with the owner already inside it", async () => {
    const { shop, owner, organizationId } = await makeShopWithTeam();

    const [org] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, organizationId));
    expect(org!.slug).toBe(`shop-${shop.id}`);

    const members = await db
      .select()
      .from(member)
      .where(eq(member.organizationId, organizationId));
    expect(members).toHaveLength(1);
    expect(members[0]!.userId).toBe(owner.id);
    expect(members[0]!.role).toBe("owner");
  });

  it("is idempotent — a retry leaves one organization and one owner", async () => {
    const { shop, organizationId } = await makeShopWithTeam();
    expect(await ensureShopOrganization(shop.id)).toBe(organizationId);

    const members = await db
      .select()
      .from(member)
      .where(eq(member.organizationId, organizationId));
    expect(members).toHaveLength(1);
  });
});

describe("the guard", () => {
  it("lets the owner do everything", async () => {
    const { shop, owner } = await makeShopWithTeam();
    for (const permission of ["orders:refund", "settings:write", "team:write"] as const) {
      const got = await as(owner, () => requireShop(permission));
      expect(got.ok, permission).toBe(true);
      if (got.ok) expect(got.value.shop.id).toBe(shop.id);
    }
  });

  it("finds a shop somebody was invited to, and names their role", async () => {
    const { shop, organizationId } = await makeShopWithTeam();
    const staff = await makeUser("staff");
    await addMember(organizationId, staff.id, "staff");

    const got = await as(staff, () => requireShop("orders:write"));
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.value.shop.id).toBe(shop.id);
      expect(got.value.role).toBe("staff");
      // The owner of record is still `shops.userId`, which is not them.
      expect(got.value.isOwner).toBe(false);
    }
  });

  it("refuses what the role does not carry, and says so", async () => {
    const { organizationId } = await makeShopWithTeam();
    const staff = await makeUser("staff");
    await addMember(organizationId, staff.id, "staff");

    const got = await as(staff, () => requireShop("orders:refund"));
    expect(got.ok).toBe(false);
    // A refusal, not a blank screen — the page names the permission.
    if (!got.ok) expect(got.to).toContain("/admin/no-access");
  });

  it("withholds the refund from a manager and grants it to the owner", async () => {
    /*
     * The spec's own worked example, through the real action rather than the
     * predicate: `orders:refund` is separate from `orders:write` precisely so
     * it can be withheld, and what has to be true is that the *button* refuses.
     */
    const { shop, owner, organizationId } = await makeShopWithTeam();
    const manager = await makeUser("manager");
    await addMember(organizationId, manager.id, "manager");

    const [order] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        productTitle: "Mug",
        currency: "USD",
        subtotalCents: 2_000,
        totalCents: 2_000,
        paymentStatus: "paid",
        status: "confirmed",
        paymentMethod: "cod",
      })
      .returning();

    const form = new FormData();
    form.append("id", order!.id);
    form.append("amount", "5");

    const refused = await as(manager, () => refundOrder({ ok: false }, form));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.to).toContain("/admin/no-access");

    // The same manager may still work the queue, which is what their role is.
    const status = new FormData();
    status.append("id", order!.id);
    status.append("status", "shipped");
    expect((await as(manager, () => updateOrderStatus(status))).ok).toBe(true);

    // And the owner reaches the refund guard rather than being turned away.
    expect((await as(owner, () => requireShop("orders:refund"))).ok).toBe(true);
  });

  it("refuses the next request after the row is gone", async () => {
    const { organizationId } = await makeShopWithTeam();
    const staff = await makeUser("staff");
    const row = await addMember(organizationId, staff.id, "staff");

    expect((await as(staff, () => requireShop("orders:read"))).ok).toBe(true);

    await db.delete(member).where(eq(member.id, row.id));

    /*
     * The role is read on every request rather than carried in the session, so
     * a removed member is out on their next one whatever their cookie says.
     * With no shop at all the guard sends them to onboarding, which is the
     * honest answer: as far as Sailo is concerned they now have no shop.
     */
    const after = await as(staff, () => requireShop("orders:read"));
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.to).toContain("/onboarding");
  });

  it("refuses a stranger with no membership at all", async () => {
    await makeShopWithTeam();
    const stranger = await makeUser("stranger");
    const got = await as(stranger, () => requireShop("orders:read"));
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.to).toContain("/onboarding");
  });

  it("gives an unknown role nothing", async () => {
    const { organizationId } = await makeShopWithTeam();
    const odd = await makeUser("odd");
    // A row written by a future build, or by hand. It must not fall through to
    // the most permissive answer.
    await addMember(organizationId, odd.id, "superuser");

    expect(roleCan("superuser", "orders:read")).toBe(false);
    expect((await as(odd, () => requireShop("orders:read"))).ok).toBe(false);
  });
});

describe("the audit trail", () => {
  it("records the actor, not the shop", async () => {
    const { shop, owner } = await makeShopWithTeam();

    await recordMemberAction({
      shopId: shop.id,
      actorEmail: owner.email.toUpperCase(),
      actorRole: "owner",
      action: "order.refund",
      subjectType: "order",
      subjectId: "abc",
      detail: { amountCents: 500 },
    });

    const [row] = await db
      .select()
      .from(shopMemberActions)
      .where(eq(shopMemberActions.shopId, shop.id));

    // The person, folded, and never a foreign key: the record has to survive
    // the account.
    expect(row!.actorEmail).toBe(owner.email.toLowerCase());
    expect(row!.actorRole).toBe("owner");
    expect(row!.action).toBe("order.refund");
    expect(row!.detail).toEqual({ amountCents: 500 });
  });

  it("survives the member being removed", async () => {
    const { shop, organizationId } = await makeShopWithTeam();
    const staff = await makeUser("staff");
    const row = await addMember(organizationId, staff.id, "staff");

    await recordMemberAction({
      shopId: shop.id,
      actorEmail: staff.email,
      actorRole: "staff",
      action: "order.ship",
    });
    await db.delete(member).where(eq(member.id, row.id));

    const rows = await db
      .select()
      .from(shopMemberActions)
      .where(eq(shopMemberActions.shopId, shop.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorEmail).toBe(staff.email.toLowerCase());
  });
});

describe("removal", () => {
  it("ends the member's sessions, not just the row", async () => {
    /*
     * The row alone is already enough — `requireShop` re-reads it — but spec 37
     * asks for the session too, and it is right to: a removed member with a
     * page already open keeps whatever that page rendered until they navigate.
     */
    const { shop, owner, organizationId } = await makeShopWithTeam();
    const staff = await makeUser("staff");
    const row = await addMember(organizationId, staff.id, "staff");

    await db.insert(session).values({
      id: uid(),
      token: uid(),
      userId: staff.id,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const form = new FormData();
    form.append("memberId", row.id);
    expect((await as(owner, () => removeTeamMember(form))).ok).toBe(true);
    expect(shop.userId).toBe(owner.id);

    expect(await db.select().from(session).where(eq(session.userId, staff.id))).toEqual([]);
    expect(await db.select().from(member).where(eq(member.id, row.id))).toEqual([]);
  });

  it("leaves the owner alone, however the form is posted", async () => {
    const { owner, organizationId } = await makeShopWithTeam();
    const [ownerRow] = await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, owner.id)));

    const remove = new FormData();
    remove.append("memberId", ownerRow!.id);
    await as(owner, () => removeTeamMember(remove));

    const demote = new FormData();
    demote.append("memberId", ownerRow!.id);
    demote.append("role", "staff");
    await as(owner, () => changeTeamRole(demote));

    // A shop with nobody able to administer it is unrecoverable, so neither is
    // a thing the form can do — checked against `shops.userId`, not the role.
    const [still] = await db.select().from(member).where(eq(member.id, ownerRow!.id));
    expect(still).toBeDefined();
    expect(still!.role).toBe("owner");
  });
});
