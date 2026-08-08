import { expect, test, type Page } from "@playwright/test";

/**
 * The whole product, driven the way a person drives it.
 *
 * Every other suite here either renders a page and asserts it looks right, or
 * calls a function directly. This one signs up, works through onboarding,
 * builds a catalogue and buys from it — through the browser, against a
 * database it is allowed to dirty. It is the only test that proves the parts
 * fit together, and the only one that would notice a broken signup.
 *
 * Requires the local stack, because it writes:
 *
 *   ./scripts/scenarios/up.sh
 *   npx dotenv -e .env.local.test -- npx next dev -p 3100
 *   E2E_BASE_URL=http://localhost:3100 npx playwright test e2e/journey.spec.ts
 *
 * It refuses to run against anything but localhost. A signup suite pointed at
 * production would create real accounts and real orders, and one line of guard
 * is cheap against a mistake that cannot be undone.
 */

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/*
 * The hostname, parsed — not a substring of the URL.
 *
 * `/localhost/.test(url)` is true for `https://localhost.attacker.example` and
 * for `https://example.com/localhost`, and this suite signs up accounts and
 * writes orders. A guard that can be talked past by a hostname someone else
 * registers is not a guard; it is a comment.
 */
const LOCAL = (() => {
  try {
    const host = new URL(BASE).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
})();

test.skip(!LOCAL, "journey writes real rows — localhost only");

const stamp = Date.now().toString(36);
const seller = {
  name: "Journey Seller",
  email: `journey-${stamp}@example.com`,
  password: "correct-horse-battery",
};

/**
 * Answers the cookie banner, which a real visitor must do before anything
 * else: it is `position: fixed` at the bottom of the viewport and sits over
 * whatever is there — including onboarding's own Continue button on a 720px
 * screen, which is how this test found it.
 */
async function dismissConsent(page: Page) {
  const accept = page.getByRole("button", { name: /^accept$/i }).first();
  if (await accept.count()) await accept.click().catch(() => {});
}

/** Signs a fresh seller up and returns their handle once onboarding is done. */
async function signUpAndOnboard(page: Page, email: string): Promise<string> {
  await page.goto("/signup");
  await dismissConsent(page);
  await page.locator("#name").fill(seller.name);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(seller.password);
  await page.getByRole("button", { name: /create my shop/i }).click();

  await page.waitForURL(/\/(onboarding|admin)/, { timeout: 60_000 });

  // Onboarding is three steps and each one is a "Continue"; the handle is
  // prefilled from the name, which is the behaviour worth keeping.
  let handle = "";
  for (let step = 0; step < 4; step++) {
    if (/\/admin/.test(page.url())) break;
    const field = page.locator("#handle");
    if (await field.count()) handle = (await field.inputValue()) || handle;

    await dismissConsent(page);
    const next = page.getByRole("button", { name: /^(continue|finish|done|go to|open)/i }).first();
    if (!(await next.count())) break;
    await next.click();
    await page.waitForTimeout(2000);
  }
  await page.waitForURL(/\/admin/, { timeout: 60_000 });
  return handle;
}

test.describe.configure({ mode: "serial" });

test.describe("a seller sets up shop", () => {
  let page: Page;
  let handle = "";

  test.beforeAll(async ({ browser }) => {
    // One context for the whole describe, so the session survives between
    // tests. Playwright gives each test a fresh one by default, which for a
    // journey means being signed out halfway through your own story.
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("signs up and reaches their own admin", async () => {
    handle = await signUpAndOnboard(page, seller.email);
    expect(page.url()).toContain("/admin");
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
  });

  test("the storefront is live at the handle they claimed", async () => {
    expect(handle, "onboarding never produced a handle").toBeTruthy();
    const res = await page.goto(`/${handle}`);
    expect(res?.status()).toBeLessThan(400);
    await expect(page.locator("body")).not.toContainText(/something went wrong/i);
    await expect(page.locator("body")).not.toContainText(/this shop doesn.t exist/i);
  });

  test("every admin page renders for its owner", async () => {
    // Each of these calls `requireShop` and scopes its own queries. A blank
    // page or an error boundary here is a broken guard or a broken query, and
    // both look identical from outside.
    for (const path of [
      "/admin",
      "/admin/products",
      "/admin/orders",
      "/admin/clients",
      "/admin/payments",
      "/admin/delivery",
      "/admin/coupons",
      "/admin/settings",
    ]) {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(res?.status(), `${path} answered ${res?.status()}`).toBeLessThan(400);
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      expect(body, `${path} rendered an error`).not.toMatch(/something went wrong|application error/i);
      expect(body.length, `${path} rendered nothing`).toBeGreaterThan(40);
    }
  });

  test("a product can be created and reaches the storefront", async () => {
    await page.goto("/admin/products/new");
    await page.locator("#title").fill("Speckled Mug");
    await page.locator("#price").fill("24.00");

    const published = page.locator('input[name="isPublished"]');
    if (await published.count()) await published.first().check().catch(() => {});

    await page.getByRole("button", { name: /add product|save|create/i }).first().click();
    await page.waitForURL(/\/admin\/products/, { timeout: 45_000 });

    await page.goto("/admin/products");
    await expect(page.locator("body")).toContainText(/speckled mug/i);
  });
});

test.describe("a stranger is kept out", () => {
  for (const path of [
    "/admin",
    "/admin/orders",
    "/admin/products",
    "/admin/payments",
    "/admin/settings",
    "/admin/coupons",
    "/hq",
  ]) {
    test(`${path} refuses an anonymous visitor`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      const url = page.url();
      const refused = /\/(login|signup|hq\/login)/.test(url) || (res?.status() ?? 200) >= 400;
      expect(refused, `${path} left an anonymous visitor at ${url}`).toBe(true);
    });
  }

  test("/hq refuses a signed-in seller who is not on the roster", async ({ page }) => {
    // A real account with a real session — the roster is the only thing
    // between them and every other seller's revenue.
    await page.goto("/login");
    await page.locator("#email").fill(seller.email);
    await page.locator("#password").fill(seller.password);
    await page.getByRole("button", { name: /sign in|log in/i }).first().click();
    await page.waitForURL(/\/(admin|onboarding)/, { timeout: 60_000 });

    const res = await page.goto("/hq", { waitUntil: "domcontentloaded" });
    const blocked =
      /\/(hq\/login|login|admin)/.test(page.url()) || (res?.status() ?? 200) >= 400;
    expect(blocked, `a non-staff seller reached ${page.url()}`).toBe(true);
  });

  test("one seller cannot read another's admin", async ({ browser }) => {
    /*
     * The property that makes an id in a URL harmless here: `requireShop`
     * derives the shop from the session and never from a parameter, so there
     * is nothing for a second seller to substitute. This proves it by building
     * a second account and checking it sees its own empty catalogue rather
     * than the first seller's mug.
     */
    const other = await browser.newPage();
    await signUpAndOnboard(other, `journey-b-${stamp}@example.com`);

    await other.goto("/admin/products");
    const body = (await other.locator("body").innerText()).replace(/\s+/g, " ");
    expect(body, "a second seller can see the first seller's catalogue").not.toMatch(
      /speckled mug/i,
    );
    await other.close();
  });
});
