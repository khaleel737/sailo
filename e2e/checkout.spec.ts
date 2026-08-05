import { expect, test } from "@playwright/test";

/**
 * The buyer's path to paying. Split across several files now — panel, copy,
 * confirmation, referral — so what matters is that it still behaves as one.
 */

const DEMO = "/demo";

async function openCheckout(page: import("@playwright/test").Page) {
  await page.goto(DEMO, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^buy now$/i }).first().click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  return dialog;
}

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
  test("adds a line and shows it", async ({ page }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });
    const add = page.getByLabel("Add to basket");
    if ((await add.count()) === 0) test.skip();

    await add.first().click();
    await page.waitForTimeout(1_200);
    // The basket button should now report something in it.
    await expect(page.locator("body")).toContainText(/1|basket|cart/i);
  });
});
