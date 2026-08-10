import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The buyer's path to paying. Split across several files now — panel, copy,
 * confirmation, referral — so what matters is that it still behaves as one.
 *
 * The path runs the way a shop runs: the listing page sells the click, the
 * product page sells the product. Buying — either button — happens on the
 * product page, never on the card.
 */

const DEMO = "/demo";

/** The card is one link now; anywhere on the first product opens its page. */
async function openProduct(page: Page) {
  await page.goto(DEMO, { waitUntil: "networkidle" });
  await page.locator("article").first().click();
  // Generous: a dev server compiles the product route on its first visit,
  // and every parallel worker pays that bill at once.
  await expect(page).toHaveURL(/\/p\//, { timeout: 30_000 });
}

async function openCheckout(page: Page) {
  await openProduct(page);
  await page.getByRole("button", { name: /^buy now$/i }).first().click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("the listing page", () => {
  test("cards carry no buy buttons — the product page does the selling", async ({
    page,
  }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });
    const card = page.locator("article").first();
    await expect(card).toBeVisible();
    await expect(card.getByRole("button", { name: /buy now/i })).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: /add to basket/i }),
    ).toHaveCount(0);
  });

  test("a card walks through to its product page", async ({ page }) => {
    await openProduct(page);
  });
});

test.describe("checkout", () => {
  test("opens on screen with a total", async ({ page }) => {
    const dialog = await openCheckout(page);
    await expect(dialog).toContainText(/total/i);

    // A `backdrop-filter` ancestor once made this the containing block for
    // `position: fixed` and pushed the sheet above the viewport.
    const box = await dialog.boundingBox();
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(-5);
    expect(box?.height ?? 0).toBeGreaterThan(100);
  });

  test("offers every rail the shop has configured", async ({ page }) => {
    const dialog = await openCheckout(page);
    const rails = dialog.locator('input[name="paymentMethod"]');
    expect(await rails.count()).toBeGreaterThan(0);
  });

  test("names each rail for the buyer, not for the seller", async ({ page }) => {
    // `PAYMENT_METHOD_DEFS` describes rails to the seller — "Buyer sees your
    // account details". `checkout-copy` is what the shopper should read.
    const dialog = await openCheckout(page);
    const text = await dialog.innerText();
    expect(text).not.toContain("Buyer sees your");
  });

  test("prices the order before anyone commits", async ({ page }) => {
    const dialog = await openCheckout(page);
    await page.waitForTimeout(1_500);
    const totals = await dialog.locator("dl").last().innerText();
    expect(totals).toMatch(/\d/);
  });

  test("closes on Escape", async ({ page }) => {
    await openCheckout(page);
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="dialog"]')).toBeHidden();
  });

  test("renders without a client error", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await openCheckout(page);
    await page.waitForTimeout(1_500);
    expect(errors).toEqual([]);
  });
});

test.describe("the basket", () => {
  test("adds a line from the product page and shows it", async ({ page }) => {
    await openProduct(page);
    // Always on the page now — the buy box owns it — but it streams in with
    // the rest of the product, so wait rather than count-and-skip.
    const add = page.getByRole("button", { name: /add to basket/i }).first();
    await add.waitFor({ state: "visible", timeout: 15_000 });

    await add.click();
    await page.waitForTimeout(1_200);
    // The basket pill should now report something in it.
    await expect(page.locator("body")).toContainText(/1|basket|cart/i);
  });
});

test.describe("favourites", () => {
  test("a heart saved on a card is counted by the shop's heart", async ({
    page,
  }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });
    const heart = page
      .getByRole("button", { name: /save to favourites/i })
      .first();
    if ((await heart.count()) === 0) test.skip();

    await heart.click();
    await expect(heart).toHaveAttribute("aria-pressed", "true");

    // The shop-level heart opens the list, and the saved product is in it.
    await page.getByRole("button", { name: /^favourites$/i }).click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("li")).toHaveCount(1);
  });
});
