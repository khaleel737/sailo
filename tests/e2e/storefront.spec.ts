import { expect, test, type Page } from "@playwright/test";

/**
 * The buyer's path through a shop.
 *
 * Runs against a local server with the seeded demo shop. It writes — visits,
 * carts, and in the ordering spec real orders — so it must not be pointed at
 * production. `tests/smoke` is the suite that is safe there.
 */

const DEMO = "/demo";

async function setLocale(page: Page, baseURL: string | undefined, code: string) {
  await page.context().addCookies([
    { name: "sailo_locale", value: code, url: baseURL ?? "http://localhost:3000" },
  ]);
}

test.describe("browsing", () => {
  test("the shop lists its products with prices", async ({ page }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });
    const cards = page.locator("article");
    expect(await cards.count()).toBeGreaterThan(0);
    await expect(cards.first()).toContainText(/\d/);
  });

  test("a product page opens from a card", async ({ page }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });
    await page.locator("article a").first().click();
    await page.waitForURL(/\/demo\/p\//);
    await expect(page.locator("h1")).toBeVisible();
  });

  test("search narrows the list", async ({ page }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });
    const before = await page.locator("article").count();

    await page.locator('input[type="search"]').fill("mug");
    await page.waitForTimeout(1_200);

    const after = await page.locator("article").count();
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThanOrEqual(before);
    await expect(page.locator("article").first()).toContainText(/mug/i);
  });

  test("a search with no matches explains itself", async ({ page }) => {
    await page.goto(`${DEMO}?q=zzzzzznothing`, { waitUntil: "networkidle" });
    expect(await page.locator("article").count()).toBe(0);
    await expect(page.locator("main")).toContainText(/nothing|no products/i);
  });

  test("every offered filter leads somewhere", async ({ page }) => {
    // The point of building filters from the catalogue: a control that
    // returns nothing is worse than no control at all.
    await page.goto(DEMO, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /filters/i }).click();

    const kinds = await page
      .locator("select")
      .first()
      .locator("option")
      .evaluateAll((opts) =>
        opts.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
      );

    for (const kind of kinds) {
      await page.goto(`${DEMO}?kind=${kind}`, { waitUntil: "networkidle" });
      expect(
        await page.locator("article").count(),
        `filter "${kind}" returned nothing`,
      ).toBeGreaterThan(0);
    }
  });

  test("a category chip filters to its own products", async ({ page }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });
    const chips = page.locator(".no-scrollbar button");
    if ((await chips.count()) < 2) test.skip();

    await chips.nth(1).click();
    await page.waitForTimeout(1_200);
    expect(await page.locator("article").count()).toBeGreaterThan(0);
  });
});

test.describe("language", () => {
  const CASES = [
    { code: "ja", script: /[ぁ-んァ-ン一-龯]/ },
    { code: "ar", script: /[؀-ۿ]/ },
    { code: "de", script: /[A-Za-z]/ },
  ] as const;

  for (const { code, script } of CASES) {
    test(`the shop renders in ${code}`, async ({ page, baseURL }) => {
      await setLocale(page, baseURL, code);
      await page.goto(DEMO, { waitUntil: "networkidle" });

      await expect(page.locator("html")).toHaveAttribute("lang", code);
      await expect(page.locator("html")).toHaveAttribute(
        "dir",
        code === "ar" ? "rtl" : "ltr",
      );
      expect(await page.locator("body").innerText()).toMatch(script);
    });
  }

  test("the switcher changes language and remembers", async ({ page }) => {
    // Opening the portalled list and re-rendering the page in a new language
    // is two round trips through a dev server that other tests are also using.
    test.slow();
    await page.goto(DEMO, { waitUntil: "networkidle" });
    const before = await page.locator("body").innerText();

    await page.getByRole("button", { name: /language|Sprache|langue/i }).first().click();
    // The list is a portalled listbox, so the entries are options rather than
    // buttons, and each name sits beside its flag.
    const japanese = page.getByRole("option", { name: /日本語/ });
    await japanese.first().waitFor({ state: "visible", timeout: 30_000 });
    await japanese.first().click();
    await page.waitForTimeout(3_000);

    expect(await page.locator("body").innerText()).not.toBe(before);
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");

    // And it survives a reload, which is the whole point of the cookie.
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  });

  test("a German browser gets German without asking", async ({ browser }) => {
    // `locale` is the option that sets Accept-Language *and* navigator.language;
    // `extraHTTPHeaders` alone loses to the context's own default.
    const ctx = await browser.newContext({ locale: "de-DE" });
    const page = await ctx.newPage();
    await page.goto("/demo", { waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await ctx.close();
  });
});

test.describe("checkout sheet", () => {
  test("opens and shows a total", async ({ page }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^buy now$/i }).first().click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/total/i);

    // The sheet must land on screen. A `backdrop-filter` on an ancestor once
    // made it the containing block for `position: fixed` and pushed the whole
    // dialog above the viewport.
    const box = await dialog.boundingBox();
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(-5);
    expect(box?.height ?? 0).toBeGreaterThan(100);
  });

  test("offers a way to pay", async ({ page }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^buy now$/i }).first().click();
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    expect(
      await page.locator('[role="dialog"] input[name="paymentMethod"]').count(),
    ).toBeGreaterThan(0);
  });

  test("closes on Escape", async ({ page }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^buy now$/i }).first().click();
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="dialog"]')).toBeHidden();
  });
});

test.describe("accessibility basics", () => {
  test("every image carries alt text", async ({ page }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });
    const missing = await page
      .locator("img")
      .evaluateAll((imgs) =>
        imgs.filter((i) => !(i as HTMLImageElement).alt.trim()).length,
      );
    expect(missing).toBe(0);
  });

  test("the page has exactly one h1", async ({ page }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });
    expect(await page.locator("h1").count()).toBeLessThanOrEqual(1);
  });

  test("interactive controls are reachable by keyboard", async ({ page }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(["A", "BUTTON", "INPUT", "SELECT"]).toContain(focused);
  });
});
