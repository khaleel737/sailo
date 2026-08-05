import { expect, test } from "@playwright/test";

/**
 * The deploy gate.
 *
 * Read-only and safe to run against production: it takes no orders, writes no
 * rows and touches no seller's data. It answers one question — is this build
 * actually serving? — and it answers it the way a visitor would, by loading
 * pages rather than by asking the app whether it feels well.
 *
 *   npx playwright test --project=smoke
 *   E2E_BASE_URL=https://sailo.store npx playwright test --project=smoke
 */

const DEMO = "/demo";

test.describe("pages respond", () => {
  for (const path of ["/", DEMO, "/login", "/signup"]) {
    test(`${path} loads`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));

      const response = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(response?.status(), `${path} status`).toBe(200);
      expect(errors, `${path} threw`).toEqual([]);
    });
  }

  test("an unknown shop is a 404, not a crash", async ({ page }) => {
    const response = await page.goto("/definitely-not-a-real-shop-xyz");
    expect(response?.status()).toBe(404);
  });

  test("the admin redirects a signed-out visitor to sign in", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("the storefront renders", () => {
  test("a shop shows its products", async ({ page }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });

    const cards = page.locator("article");
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(0);

    // Present in the DOM is not the same as laid out. A CSS regression that
    // collapses every card to zero height passes a text assertion.
    const box = await cards.first().boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(50);
    expect(box?.height ?? 0).toBeGreaterThan(50);
  });

  test("nothing overflows the viewport", async ({ page }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("prices are rendered, not left as placeholders", async ({ page }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });
    await expect(page.locator("article").first()).toContainText(/\d/);
  });
});

test.describe("critical endpoints", () => {
  test("the Stripe webhook rejects an unsigned request", async ({ request }) => {
    // Live and refusing is the signal. A 200 here would mean anyone can
    // mark orders paid; a 404 would mean the route didn't deploy.
    const res = await request.post("/api/stripe/webhook", { data: {} });
    expect(res.status()).toBe(400);
  });

  test("the cron sweep rejects an unauthorised caller", async ({ request }) => {
    const res = await request.get("/api/cron/sweep");
    expect(res.status()).toBe(401);
  });

  test("a forged cron user-agent is still refused", async ({ request }) => {
    // This was once enough to cancel a shop's pending orders.
    const res = await request.get("/api/cron/sweep", {
      headers: { "user-agent": "vercel-cron/1.0" },
    });
    expect(res.status()).toBe(401);
  });

  test("tracking accepts a beacon", async ({ request }) => {
    const res = await request.post("/api/track", {
      data: { shopId: "00000000-0000-0000-0000-000000000000" },
    });
    // A real shop id would record a visit; an unknown one must 404 rather
    // than 500. Either proves the route is alive.
    expect([200, 404]).toContain(res.status());
  });
});

test.describe("localisation is wired up", () => {
  test("the page declares its language and direction", async ({ page }) => {
    await page.goto(DEMO);
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", /^[a-z]{2}$/);
    await expect(html).toHaveAttribute("dir", /^(ltr|rtl)$/);
  });

  test("Arabic flips the document", async ({ page, context, baseURL }) => {
    // The cookie has to be scoped to the origin under test — `page.url()` is
    // still blank before the first navigation.
    await context.addCookies([
      { name: "sailo_locale", value: "ar", url: baseURL ?? "http://localhost:3000" },
    ]);
    await page.goto(DEMO, { waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });
});
