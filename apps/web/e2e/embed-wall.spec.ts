import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  shops,
  testimonialWalls,
  testimonials,
  user,
} from "@sailo/db/schema";
import { assertLocalDatabase } from "./scenarios/local-only";

/**
 * The wall of love, inside a **cross-origin** iframe, in a real browser.
 *
 * This is the assertion spec 35 says nothing else will make. Every other test
 * in this feature can pass while the embed is completely unusable, because the
 * thing that breaks it is a *response header* — `X-Frame-Options: DENY` and
 * `frame-ancestors 'none'`, set globally in `next.config.ts` and correct for
 * every other route in the app. A unit test cannot see a header, a scenario
 * test does not make an HTTP request, and a same-origin iframe is exempt from
 * both rules, so it would render either way and prove nothing.
 *
 * Hence a genuinely different origin. `page.route` fulfils a document on
 * `https://embed-host.test/` and the browser then treats the Sailo page inside
 * it as third-party framing — which is exactly what a seller's Framer or
 * Squarespace site does.
 *
 * The failure this catches is silent and remote: the seller sees a blank
 * rectangle on a site we have no access to, and nothing on our side logs
 * anything at all.
 */

/*
 * `http`, not `https`, and only because the dev server under test is `http`:
 * an https parent may not frame an http child, so a secure fake origin would
 * fail on mixed content rather than on anything this test is about. In
 * production both sides are https and the question does not arise. What
 * matters here is that it is a *different origin*, which it is.
 */
const HOST = "http://embed-host.test/";

/**
 * Chrome's Local Network Access check, switched off for this file only.
 *
 * It refuses a request from a public-looking origin to a loopback address —
 * which is every local test that frames a dev server, and has nothing to do
 * with the headers under test. Without the flag the frame fails with
 * `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS` before any Sailo header is
 * consulted, so the test would pass or fail for the wrong reason. In production
 * both origins are ordinary public https and the check never applies.
 */
test.use({
  launchOptions: {
    args: ["--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessChecks"],
  },
});

test.describe("the testimonial embed", () => {
  let embedKey = "";
  let shopId = "";

  test.beforeAll(async () => {
    /*
     * The same guard the scenario suites use. This writes rows, and the one
     * database the app could otherwise reach is production's.
     */
    assertLocalDatabase();

    const db = getDb();
    const userId = crypto.randomUUID();
    await db.insert(user).values({
      id: userId,
      name: "Embed Seller",
      email: `embed-${userId.slice(0, 8)}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const [shop] = await db
      .insert(shops)
      .values({
        userId,
        handle: `embed-${userId.slice(0, 8)}`,
        name: "Embed Shop",
        currency: "USD",
        isPublished: true,
        plan: "business",
        subscriptionStatus: "active",
      })
      .returning();
    if (!shop) throw new Error("fixture: shop was not inserted");
    shopId = shop.id;

    const [wall] = await db
      .insert(testimonialWalls)
      .values({
        shopId: shop.id,
        name: "Homepage",
        slug: "homepage",
        headline: "What people say",
        isPublished: true,
        embedKey: crypto.randomUUID().replaceAll("-", "").padEnd(48, "0").slice(0, 48),
      })
      .returning();
    if (!wall) throw new Error("fixture: wall was not inserted");
    embedKey = wall.embedKey;

    await db.insert(testimonials).values([
      {
        shopId: shop.id,
        wallId: wall.id,
        authorName: "Ada Lovelace",
        authorRole: "Analyst",
        body: "They shipped it in two days and answered every email.",
        isApproved: true,
      },
      {
        shopId: shop.id,
        wallId: wall.id,
        authorName: "Nobody Yet",
        body: "This one is still waiting to be approved.",
        isApproved: false,
      },
    ]);
  });

  test.afterAll(async () => {
    if (shopId) await getDb().delete(shops).where(eq(shops.id, shopId));
  });

  test("renders inside an iframe on somebody else's origin", async ({ page, baseURL }) => {
    const src = `${baseURL}/embed/wall/${embedKey}`;

    // A real document on a real other origin, without needing a second server.
    await page.route(HOST, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><title>A seller's own site</title>
               <iframe id="wall" src="${src}" width="600" height="600"></iframe>`,
      }),
    );
    await page.goto(HOST);

    const frame = page.frameLocator("#wall");
    /*
     * The assertion is that *content* arrived. A blocked frame is not an error
     * the parent can see — it is an empty document — so checking for text is
     * the only way to tell "framed" from "silently refused".
     */
    await expect(frame.getByText("Ada Lovelace")).toBeVisible({ timeout: 30_000 });
    await expect(frame.getByText("What people say")).toBeVisible();

    // And the moderation gate holds on the surface furthest from the seller.
    await expect(
      frame.getByText("This one is still waiting to be approved."),
    ).toHaveCount(0);
  });

  test("sends no header that would stop a stranger framing it", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/embed/wall/${embedKey}`);
    expect(res.status()).toBe(200);

    /*
     * `X-Frame-Options` has no "allow anyone" value, so the only correct state
     * is absent — which is why the embed is *excluded* from the global header
     * rule rather than layered over it. A later refactor that collapses the two
     * rules back together fails here.
     */
    expect(res.headers()["x-frame-options"]).toBeUndefined();
    const csp = res.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("frame-ancestors *");
    // And the storefront's own protection is untouched by all of that.
    const shopRes = await request.get(`${baseURL}/`);
    expect(shopRes.headers()["x-frame-options"]).toBe("DENY");
    expect(shopRes.headers()["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
  });

  test("answers an unknown key the way it answers an unpublished one", async ({
    request,
    baseURL,
  }) => {
    const unknown = await request.get(`${baseURL}/embed/wall/${"0".repeat(48)}`);
    // A 404 for both, so trying keys tells nobody which shops exist.
    expect(unknown.status()).toBe(404);
  });
});
