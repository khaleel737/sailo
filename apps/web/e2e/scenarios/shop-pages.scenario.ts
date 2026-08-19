import { assertLocalDatabase } from "./local-only";
import { purgeFixtures } from "./purge";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { policySnapshots, shopPages, shops, user } from "@sailo/db/schema";
import { renderShopPage, renderShopPages, shopPageFacts } from "@sailo/core/shop-pages";

/**
 * Spec 41 — the seller's own documents, and the loop they close.
 *
 * The templates are pinned by unit tests in `packages/core`; this is the half
 * that needs a database, and almost all of it is about one thing:
 *
 * **`policySnapshotsForOrder` can finally take the good path.** Spec 44 left it
 * resolving only snapshots that already existed, because a checkout must not
 * wait on a seller's own web host — so the only source it could ever find was
 * something a scheduled job had fetched from `shops.termsUrl`, which is the
 * weak one. `policies.ts` says why in as many words: *a URL that changed is not
 * evidence.* A shop page needs no fetch, so the text is snapshotted straight out
 * of `body_md` with `source = 'shop_page'`, at checkout, with no network in the
 * path at all.
 *
 * The other property under test is that generating is **never destructive**. A
 * seller who rewrites their refund policy and presses Generate again must find
 * their words where they left them.
 */

const {
  createMissingPages,
  publishedPageBySlug,
  publishedPagesFor,
  replacePageBody,
  savePage,
  setPagePublished,
  shopPageOfKind,
  shopPagesFor,
  slugTakenBy,
  storefrontSectionsFor,
} = await import("@sailo/commerce/pages");
const { policySnapshotsForOrder, snapshotPolicy } = await import(
  "@sailo/commerce/disputes"
);

const db = getDb();
const uid = () => crypto.randomUUID();
const PREFIX = "pages-";

beforeAll(async () => {
  assertLocalDatabase();
  await purgeFixtures([PREFIX]);
});

async function sellerShop(over: Partial<typeof shops.$inferInsert> = {}) {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email: `${PREFIX}${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const [shop] = await db
    .insert(shops)
    .values({
      userId,
      handle: `${PREFIX}${userId.slice(0, 8)}`,
      name: "Speckled Ceramics",
      currency: "USD",
      isPublished: true,
      plan: "free",
      ...over,
    })
    .returning();
  if (!shop) throw new Error("fixture: shop was not inserted");
  return shop;
}

const facts = (shop: typeof shops.$inferSelect, refundWindowDays: number | null = 14) =>
  shopPageFacts(
    shop,
    {
      refundWindowDays,
      extraDataCollected: null,
      usesAnalytics: false,
      shipsPhysicalGoods: true,
    },
    { sells: ["physical"], generatedOn: "2026-08-19" },
  );

/* ------------------------------------------------------------------------- */

describe("generating", () => {
  it("writes five drafts, and none of them is live", async () => {
    const shop = await sellerShop();
    const created = await createMissingPages(shop.id, renderShopPages(facts(shop)));

    expect(created.toSorted()).toEqual(
      ["about", "faq", "privacy", "refunds", "terms"].toSorted(),
    );

    const rows = await shopPagesFor(shop.id);
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => !row.isPublished)).toBe(true);
    // Nothing a buyer can reach until the seller has read it.
    expect(await publishedPagesFor(shop.id)).toEqual([]);
  });

  it("never overwrites a page the seller has edited", async () => {
    /*
     * THE PROPERTY THAT MAKES GENERATE SAFE TO PRESS TWICE
     *
     * A generator that re-rendered on every run would discard a seller's words
     * the first time a template changed, and a seller who rewrote a refund
     * clause and found it reverted never trusts the feature again. Replacing is
     * `replacePageBody`, which the admin calls only after showing the diff.
     */
    const shop = await sellerShop();
    await createMissingPages(shop.id, renderShopPages(facts(shop)));

    await savePage({
      shopId: shop.id,
      kind: "refunds",
      title: "Our returns",
      slug: "returns",
      bodyMd: "We take everything back, always. Ask Ada.",
      isPublished: false,
    });

    const created = await createMissingPages(shop.id, renderShopPages(facts(shop)));
    expect(created).toEqual([]);

    const page = await shopPageOfKind(shop.id, "refunds");
    expect(page?.bodyMd).toBe("We take everything back, always. Ask Ada.");
    // The stamp follows the words: this is no longer a generated document, so
    // a template migration must not list this shop as one to update.
    expect(page?.source).toBe("custom");
    expect(page?.templateVersion).toBeNull();
  });

  it("survives a regenerate that collides on the renamed slug", async () => {
    /*
     * The seller above renamed `refunds` to `/returns`. A second generate offers
     * a row that collides on (shop, kind) and *not* on (shop, slug), which is
     * why the insert names no conflict target — naming either index would leave
     * the other unhandled and throw where "that page already exists" is right.
     */
    const shop = await sellerShop();
    await createMissingPages(shop.id, renderShopPages(facts(shop)));
    await savePage({
      shopId: shop.id,
      kind: "refunds",
      title: "Our returns",
      slug: "returns",
      bodyMd: "Ask Ada.",
      isPublished: false,
    });

    await expect(
      createMissingPages(shop.id, renderShopPages(facts(shop))),
    ).resolves.toEqual([]);
  });

  it("replaces a body only when asked to, explicitly", async () => {
    const shop = await sellerShop();
    await createMissingPages(shop.id, renderShopPages(facts(shop)));
    await savePage({
      shopId: shop.id,
      kind: "terms",
      title: "Terms",
      slug: "terms",
      bodyMd: "Mine.",
      isPublished: false,
    });

    await replacePageBody(shop.id, renderShopPage("terms", facts(shop)));

    const page = await shopPageOfKind(shop.id, "terms");
    expect(page?.bodyMd).not.toBe("Mine.");
    expect(page?.source).toBe("generated");
    expect(page?.templateVersion).toBeTruthy();
  });
});

describe("publishing", () => {
  it("is what makes a page reachable, and taking it down is what unmakes it", async () => {
    const shop = await sellerShop();
    await createMissingPages(shop.id, renderShopPages(facts(shop)));

    expect(await publishedPageBySlug(shop.id, "terms")).toBeNull();

    await setPagePublished(shop.id, "terms", true);
    const live = await publishedPageBySlug(shop.id, "terms");
    expect(live?.kind).toBe("terms");

    await setPagePublished(shop.id, "terms", false);
    expect(await publishedPageBySlug(shop.id, "terms")).toBeNull();
  });

  it("refuses a slug another of the shop's pages already holds", async () => {
    const shop = await sellerShop();
    await createMissingPages(shop.id, renderShopPages(facts(shop)));

    expect(await slugTakenBy(shop.id, "privacy", "terms")).toBe(true);
    // Its own slug is not "taken" by it — otherwise no page could ever be saved.
    expect(await slugTakenBy(shop.id, "terms", "terms")).toBe(false);
  });

  it("hands the storefront only what is published", async () => {
    const shop = await sellerShop();
    await createMissingPages(shop.id, renderShopPages(facts(shop)));
    await setPagePublished(shop.id, "faq", true);

    const sections = await storefrontSectionsFor(shop.id);
    expect(sections.faq?.kind).toBe("faq");
    expect(sections.about).toBeNull();
  });

  it("scopes every read to one shop", async () => {
    const mine = await sellerShop();
    const theirs = await sellerShop();
    await createMissingPages(theirs.id, renderShopPages(facts(theirs)));
    await setPagePublished(theirs.id, "terms", true);

    expect(await publishedPageBySlug(mine.id, "terms")).toBeNull();
    expect(await shopPagesFor(mine.id)).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- */

describe("the loop spec 44 left open", () => {
  it("snapshots the page's own text, with no network in the path", async () => {
    const shop = await sellerShop();
    await createMissingPages(shop.id, renderShopPages(facts(shop)));
    await setPagePublished(shop.id, "terms", true);
    await setPagePublished(shop.id, "refunds", true);

    const { termsSnapshotId, refundSnapshotId } = await policySnapshotsForOrder(shop);
    expect(termsSnapshotId).toBeTruthy();
    expect(refundSnapshotId).toBeTruthy();

    const snapshot = await db.query.policySnapshots.findFirst({
      where: eq(policySnapshots.id, termsSnapshotId!),
    });
    const page = await shopPageOfKind(shop.id, "terms");

    expect(snapshot?.source).toBe("shop_page");
    /*
     * The text, not a reference to it. This is the whole argument in
     * `policies.ts`: an issuer following a seller's URL four months later reads
     * whatever is on that host today, and a URL that changed is not evidence.
     */
    expect(snapshot?.body).toContain("These terms are between you and");
    expect(snapshot?.body).toContain("Speckled Ceramics");
    // Normalised, so it is the same words the seller published rather than a
    // near-copy — `normalisePolicy` only touches whitespace.
    expect(page?.bodyMd?.replace(/[ \t]+$/gm, "").trim()).toBe(snapshot?.body);
    // No URL: there is no origin to print, and half a link reads as a broken one.
    expect(snapshot?.sourceUrl).toBeNull();
  });

  it("will not snapshot a draft", async () => {
    /*
     * An unpublished page is not a document the buyer could have seen.
     * Recording it as the policy they agreed to is precisely the overstatement
     * this subsystem exists to prevent.
     */
    const shop = await sellerShop();
    await createMissingPages(shop.id, renderShopPages(facts(shop)));

    const { termsSnapshotId } = await policySnapshotsForOrder(shop);
    expect(termsSnapshotId).toBeNull();
  });

  it("keeps one snapshot row however many orders point at it", async () => {
    const shop = await sellerShop();
    await createMissingPages(shop.id, renderShopPages(facts(shop)));
    await setPagePublished(shop.id, "terms", true);

    const first = await policySnapshotsForOrder(shop);
    const second = await policySnapshotsForOrder(shop);
    expect(second.termsSnapshotId).toBe(first.termsSnapshotId);

    const rows = await db
      .select()
      .from(policySnapshots)
      .where(eq(policySnapshots.shopId, shop.id));
    expect(rows.filter((row) => row.kind === "terms")).toHaveLength(1);
  });

  it("writes a second snapshot when the seller edits the page, and the first survives", async () => {
    /*
     * What an evidence pack needs from this: an order placed in March must keep
     * pointing at March's text after the seller rewrites the page in August.
     * Content-addressing gives that for free — an edit is a new hash and a new
     * row, and nothing updates the old one.
     */
    const shop = await sellerShop();
    await createMissingPages(shop.id, renderShopPages(facts(shop)));
    await setPagePublished(shop.id, "terms", true);

    const before = await policySnapshotsForOrder(shop);

    await savePage({
      shopId: shop.id,
      kind: "terms",
      title: "Terms",
      slug: "terms",
      bodyMd: "Everything is final. No refunds under any circumstances whatsoever.",
      isPublished: true,
    });

    const after = await policySnapshotsForOrder(shop);
    expect(after.termsSnapshotId).not.toBe(before.termsSnapshotId);

    const original = await db.query.policySnapshots.findFirst({
      where: eq(policySnapshots.id, before.termsSnapshotId!),
    });
    expect(original).toBeTruthy();
    expect(original?.body).not.toContain("Everything is final");
  });

  it("falls back to a fetched snapshot when there is no page", async () => {
    /*
     * The weaker source is still a source. A shop that pointed `termsUrl` at
     * its own site and never wrote a page here must keep the snapshot the
     * scheduled refresh stored, rather than losing it to a shop-page lookup that
     * finds nothing.
     */
    const shop = await sellerShop();
    const fetched = await snapshotPolicy({
      shopId: shop.id,
      kind: "terms",
      body: "Fetched from the seller's own website, some time ago, by a cron job.",
      source: "url_fetch",
      sourceUrl: "https://example.com/terms",
    });

    const { termsSnapshotId } = await policySnapshotsForOrder(shop);
    expect(termsSnapshotId).toBe(fetched);
  });

  it("prefers the page over a fetched snapshot once one is published", async () => {
    const shop = await sellerShop();
    const fetched = await snapshotPolicy({
      shopId: shop.id,
      kind: "terms",
      body: "Fetched from the seller's own website, some time ago, by a cron job.",
      source: "url_fetch",
      sourceUrl: "https://example.com/terms",
    });

    await createMissingPages(shop.id, renderShopPages(facts(shop)));
    await setPagePublished(shop.id, "terms", true);

    const { termsSnapshotId } = await policySnapshotsForOrder(shop);
    expect(termsSnapshotId).not.toBe(fetched);

    const snapshot = await db.query.policySnapshots.findFirst({
      where: eq(policySnapshots.id, termsSnapshotId!),
    });
    expect(snapshot?.source).toBe("shop_page");
  });
});

describe("the shop_pages table itself", () => {
  it("cascades with the shop", async () => {
    const shop = await sellerShop();
    await createMissingPages(shop.id, renderShopPages(facts(shop)));
    await db.delete(shops).where(eq(shops.id, shop.id));

    const rows = await db
      .select()
      .from(shopPages)
      .where(eq(shopPages.shopId, shop.id));
    expect(rows).toEqual([]);
  });
});
