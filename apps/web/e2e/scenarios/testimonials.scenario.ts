import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertLocalDatabase } from "./local-only";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  broadcastDeliveries,
  clients,
  shops,
  testimonialRequests,
  testimonialWalls,
  testimonials,
  user,
} from "@sailo/db/schema";
import {
  addManualTestimonial,
  approvedTestimonials,
  createWall,
  hashRequestToken,
  raiseTestimonialRequests,
  requestForToken,
  rotateEmbedKey,
  submitTestimonial,
  updateWall,
  wallForEmbedKey,
} from "@sailo/marketing/testimonials/server";
import { suppress } from "@sailo/marketing/broadcasts/server";

/**
 * Spec 35, against real rows.
 *
 * Four things are only true against a database, and each is a way the feature
 * could be wrong while every unit test passed:
 *
 *   1. **A used link cannot be used twice.** The burn is a conditional UPDATE
 *      before the insert, which is the difference between "one testimonial per
 *      invitation" and "one per press of the button".
 *   2. **Nothing public until approved.** The storefront read, the checkout
 *      read and the embed all go through one WHERE, and the test that matters
 *      is the one that submits and then looks at the public surface.
 *   3. **A rotated key stops working.** That is the only revocation an iframe
 *      in somebody else's HTML can have.
 *   4. **Requests respect suppressions and the daily quota.** Both are shared
 *      with every other seller's mail, and a bypass here is their problem.
 *
 * Run with:
 *   npx dotenv -e .env.local.test -- \
 *     npx vitest run --config vitest.scenarios.mts e2e/scenarios/testimonials.scenario.ts
 */

const db = getDb();
const uid = () => crypto.randomUUID();

const BLOB = "https://store123.public.blob.vercel-storage.com/face.jpg";

beforeAll(() => {
  assertLocalDatabase();
});

beforeEach(() => {
  vi.useRealTimers();
});

async function makeShop(over: Partial<typeof shops.$inferInsert> = {}) {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email: `tm-${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `tm-${userId.slice(0, 8)}`,
      name: "Praise Shop",
      currency: "USD",
      isPublished: true,
      plan: "business",
      subscriptionStatus: "active",
      // Old enough that the warm-up ramp is not the binding ceiling.
      createdAt: new Date(Date.now() - 90 * 86_400_000),
      ...over,
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");
  return shop;
}

async function makeClient(shopId: string, email: string) {
  const [row] = await db
    .insert(clients)
    .values({ shopId, name: email.split("@")[0]!, email })
    .returning();
  if (!row) throw new Error("fixture: client was not inserted");
  return row;
}

/** One invitation, and the plain token it hands back exactly once. */
async function invite(shop: Awaited<ReturnType<typeof makeShop>>, email: string) {
  const client = await makeClient(shop.id, email);
  const outcome = await raiseTestimonialRequests({
    shop,
    recipients: [{ email, clientId: client.id }],
  });
  const first = outcome.sent[0];
  if (!first) throw new Error(`fixture: nothing sent — ${JSON.stringify(outcome)}`);
  return { token: first.token, client, outcome };
}

const words = {
  authorName: "Ada L",
  authorRole: "Analyst",
  body: "They shipped it in two days and answered every email.",
  videoUrl: "",
  avatarUrl: "",
};

describe("asking", () => {
  it("stores only the hash, and the plain token exactly once", async () => {
    const shop = await makeShop();
    const { token } = await invite(shop, "ada@example.com");

    const [row] = await db
      .select()
      .from(testimonialRequests)
      .where(eq(testimonialRequests.shopId, shop.id));
    expect(row!.tokenHash).toBe(hashRequestToken(token));
    expect(row!.tokenHash).not.toBe(token);
    expect(row!.expiresAt).not.toBeNull();
  });

  it("counts against the broadcast quota, in the same ledger", async () => {
    const shop = await makeShop();
    await invite(shop, "ada@example.com");

    /*
     * A row in `broadcast_deliveries` with a null broadcast — which is what
     * that table already supports for automations. One ledger, so a bounce
     * from a request reaches suppression through the machinery that already
     * exists rather than a second table somebody has to remember.
     */
    const rows = await db
      .select()
      .from(broadcastDeliveries)
      .where(eq(broadcastDeliveries.shopId, shop.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.broadcastId).toBeNull();
    expect(rows[0]!.status).toBe("sent");
  });

  it("skips somebody who asked not to hear from this shop, and says so", async () => {
    const shop = await makeShop();
    const gone = await makeClient(shop.id, "gone@example.com");
    const here = await makeClient(shop.id, "here@example.com");
    await suppress({ shopId: shop.id, email: "gone@example.com", reason: "unsubscribed" });

    const outcome = await raiseTestimonialRequests({
      shop,
      recipients: [
        { email: "gone@example.com", clientId: gone.id },
        { email: "here@example.com", clientId: here.id },
      ],
    });

    expect(outcome.sent.map((s) => s.email)).toEqual(["here@example.com"]);
    // No silent caps: the seller is told how many were skipped and why.
    expect(outcome.suppressed).toBe(1);

    const rows = await db
      .select()
      .from(testimonialRequests)
      .where(eq(testimonialRequests.shopId, shop.id));
    expect(rows.map((r) => r.email)).toEqual(["here@example.com"]);
  });

  it("stops at the day's sending allowance rather than quietly truncating", async () => {
    // Free has no broadcast allowance at all, which is the sharpest version of
    // the same ceiling — and the outcome has to *report* the shortfall.
    const shop = await makeShop({ plan: "free", subscriptionStatus: null });
    const one = await makeClient(shop.id, "a@example.com");
    const two = await makeClient(shop.id, "b@example.com");

    const outcome = await raiseTestimonialRequests({
      shop,
      recipients: [
        { email: "a@example.com", clientId: one.id },
        { email: "b@example.com", clientId: two.id },
      ],
    });
    expect(outcome.sent).toHaveLength(0);
    expect(outcome.overBudget).toBe(2);
    expect(
      await db.select().from(testimonialRequests).where(eq(testimonialRequests.shopId, shop.id)),
    ).toEqual([]);
  });
});

describe("submitting", () => {
  it("lands unapproved, and stays off every public surface until approved", async () => {
    const shop = await makeShop();
    const { token } = await invite(shop, "ada@example.com");

    const result = await submitTestimonial(token, words);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.testimonial.isApproved).toBe(false);
    expect(result.testimonial.source).toBe("requested");

    expect(await approvedTestimonials({ shopId: shop.id })).toEqual([]);

    await db
      .update(testimonials)
      .set({ isApproved: true })
      .where(eq(testimonials.id, result.testimonial.id));

    const shown = await approvedTestimonials({ shopId: shop.id });
    expect(shown.map((t) => t.id)).toEqual([result.testimonial.id]);
  });

  it("refuses a second submission on the same link", async () => {
    const shop = await makeShop();
    const { token } = await invite(shop, "ada@example.com");

    expect((await submitTestimonial(token, words)).ok).toBe(true);
    const second = await submitTestimonial(token, words);
    expect(second).toEqual({ ok: false, reason: "used" });

    // One row, not two: the burn is a conditional UPDATE before the insert.
    expect(
      await db.select().from(testimonials).where(eq(testimonials.shopId, shop.id)),
    ).toHaveLength(1);
  });

  it("refuses an expired link, and answers as it does an unknown one", async () => {
    const shop = await makeShop();
    const { token } = await invite(shop, "ada@example.com");
    await db
      .update(testimonialRequests)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(testimonialRequests.shopId, shop.id));

    const expired = await submitTestimonial(token, words);
    const unknown = await submitTestimonial("f".repeat(48), words);
    expect(expired).toEqual(unknown);
    expect(await requestForToken(token)).toBeNull();
  });

  it("guards both seller-supplied URLs at the write", async () => {
    const shop = await makeShop();

    const badVideo = await invite(shop, "v@example.com");
    expect(
      await submitTestimonial(badVideo.token, {
        ...words,
        videoUrl: "https://evil.tld/watch?v=abcdefg",
      }),
    ).toEqual({ ok: false, reason: "video" });

    const badAvatar = await invite(shop, "a@example.com");
    expect(
      await submitTestimonial(badAvatar.token, {
        ...words,
        avatarUrl: "http://169.254.169.254/latest/meta-data/",
      }),
    ).toEqual({ ok: false, reason: "avatar" });

    // Nothing was written, and neither link was burned — a refusal over a bad
    // URL must not cost somebody their one invitation.
    expect(
      await db.select().from(testimonials).where(eq(testimonials.shopId, shop.id)),
    ).toEqual([]);
    expect(await requestForToken(badVideo.token)).not.toBeNull();

    // And the allowed shapes go through.
    const good = await submitTestimonial(badVideo.token, {
      ...words,
      videoUrl: "https://youtu.be/dQw4w9WgXcQ",
      avatarUrl: BLOB,
    });
    expect(good.ok).toBe(true);
  });

  it("refuses one with neither words nor a video", async () => {
    const shop = await makeShop();
    const { token } = await invite(shop, "ada@example.com");
    expect(
      await submitTestimonial(token, { ...words, body: "   " }),
    ).toEqual({ ok: false, reason: "empty" });
  });
});

describe("the embed", () => {
  async function publishedWall(shopId: string) {
    const wall = await createWall(shopId, "Homepage", "What people say");
    if (!wall) throw new Error("fixture: wall was not created");
    await updateWall(shopId, wall.id, { isPublished: true });
    return wall;
  }

  it("serves approved items only, and 404s an unknown key", async () => {
    const shop = await makeShop();
    const wall = await publishedWall(shop.id);

    const hidden = await addManualTestimonial(shop.id, { ...words, authorName: "Hidden" });
    const shown = await addManualTestimonial(shop.id, { ...words, authorName: "Shown" });
    if (!hidden.ok || !shown.ok) throw new Error("fixture: manual insert failed");

    await db
      .update(testimonials)
      .set({ wallId: wall.id })
      .where(eq(testimonials.shopId, shop.id));
    await db
      .update(testimonials)
      .set({ isApproved: false })
      .where(eq(testimonials.id, hidden.testimonial.id));

    const found = await wallForEmbedKey(wall.embedKey);
    expect(found?.items.map((t) => t.authorName)).toEqual(["Shown"]);
    expect(await wallForEmbedKey("0".repeat(48))).toBeNull();
  });

  it("shows nothing for an unpublished wall, and says so the same way", async () => {
    const shop = await makeShop();
    const wall = await createWall(shop.id, "Draft", null);
    expect(await wallForEmbedKey(wall!.embedKey)).toBeNull();
  });

  it("stops the old address working when the key is rotated", async () => {
    const shop = await makeShop();
    const wall = await publishedWall(shop.id);
    const before = wall.embedKey;

    const after = await rotateEmbedKey(shop.id, wall.id);
    expect(after).not.toBe(before);
    expect(await wallForEmbedKey(before)).toBeNull();
    expect(await wallForEmbedKey(after!)).not.toBeNull();
  });

  it("goes dark with the shop", async () => {
    const shop = await makeShop();
    const wall = await publishedWall(shop.id);
    await db
      .update(shops)
      .set({ suspendedAt: new Date() })
      .where(eq(shops.id, shop.id));
    expect(await wallForEmbedKey(wall.embedKey)).toBeNull();
  });
});

describe("what survives a deleted contact", () => {
  it("keeps the words and the name, and drops the link to the person", async () => {
    const shop = await makeShop();
    const { token, client } = await invite(shop, "ada@example.com");
    const result = await submitTestimonial(token, words);
    if (!result.ok) throw new Error("fixture: submission failed");

    await db.delete(clients).where(eq(clients.id, client.id));

    const [row] = await db
      .select()
      .from(testimonials)
      .where(eq(testimonials.id, result.testimonial.id));
    // Spec 03's rule applied to published marketing: the seller is relying on
    // it, so it stays — but it stops being attributable.
    expect(row!.authorName).toBe("Ada L");
    expect(row!.clientId).toBeNull();
  });

  it("keeps the testimonials when a wall is deleted", async () => {
    const shop = await makeShop();
    const wall = await createWall(shop.id, "Homepage", null);
    const added = await addManualTestimonial(shop.id, words);
    if (!added.ok || !wall) throw new Error("fixture failed");
    await db
      .update(testimonials)
      .set({ wallId: wall.id })
      .where(eq(testimonials.id, added.testimonial.id));

    await db.delete(testimonialWalls).where(eq(testimonialWalls.id, wall.id));

    const [row] = await db
      .select()
      .from(testimonials)
      .where(eq(testimonials.id, added.testimonial.id));
    // `set null`, so deleting a wall throws away the arrangement rather than
    // the content.
    expect(row).toBeDefined();
    expect(row!.wallId).toBeNull();
  });
});
