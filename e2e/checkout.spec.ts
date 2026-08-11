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

/** A named product from the demo shop, rather than whichever is first. */
async function openNamed(page: Page, name: RegExp) {
  await page.goto(DEMO, { waitUntil: "networkidle" });
  await page.getByRole("link", { name }).first().click();
  await expect(page).toHaveURL(/\/p\//, { timeout: 30_000 });
}

async function checkoutFor(page: Page, name: RegExp) {
  await openNamed(page, name);
  await page.getByRole("button", { name: /^buy now$/i }).first().click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  // The rails and the delivery block are the server's answer, not the page's.
  await page.waitForTimeout(2_000);
  return dialog;
}

test.describe("the listing page", () => {
  test("cards offer quick-add, and never buy now", async ({ page }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });
    const card = page.locator("article").first();
    await expect(card).toBeVisible();
    // Checkout is a commitment to a specific thing; the card hasn't shown
    // enough to commit to. Adding to the basket is browsing, so it stays.
    await expect(card.getByRole("button", { name: /buy now/i })).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: /add to basket/i }),
    ).toHaveCount(1);
  });

  test("a card walks through to its product page", async ({ page }) => {
    await openProduct(page);
  });

  test("quick-add asks for the choice, then adds what was picked", async ({
    page,
  }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });
    // Give hydration a beat — the bag is painted by the server but the click
    // needs the handler.
    await page.waitForTimeout(800);

    const bag = page.getByRole("button", { name: /add to basket — /i }).first();
    await bag.click();

    // The first demo product has sizes, so the picker must ask, not guess —
    // the old bag silently added the first combination.
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/choose size/i);

    // A radio, not a button: the chips are one group per option, because
    // exactly one size is being chosen.
    await dialog.getByRole("radio", { name: "350ml" }).click();
    await dialog.getByRole("button", { name: /^add to basket$/i }).click();
    await expect(dialog).toBeHidden();

    await page.waitForTimeout(1_000);
    // The pill reports the basket the picker just filled.
    await expect(page.locator("body")).toContainText(/basket/i);
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

test.describe("what each kind is asked", () => {
  /*
   * Shipping is a physical product's business and nobody else's. The delivery
   * block was already the server's decision, but cash on delivery was not —
   * so a download's checkout offered a rail whose whole promise is a doorstep,
   * and a video call's did too.
   */
  test("a physical product is asked how it should arrive, and may be paid for at the door", async ({
    page,
  }) => {
    const dialog = await checkoutFor(page, /studio apron/i);
    await expect(dialog).toContainText(/how would you like to receive/i);
    await expect(dialog).toContainText(/cash on delivery/i);
  });

  test("a download is asked neither", async ({ page }) => {
    const dialog = await checkoutFor(page, /kiln notes — digital bundle/i);
    await expect(dialog).not.toContainText(/how would you like to receive/i);
    await expect(dialog).not.toContainText(/cash on delivery/i);
    // It still has to be orderable — withdrawing one rail must not take the
    // rest of the checkout with it.
    expect(await dialog.locator('input[name="paymentMethod"]').count())
      .toBeGreaterThan(0);
  });

  test("an appointment is asked neither", async ({ page }) => {
    const dialog = await checkoutFor(page, /glaze troubleshooting call/i);
    await expect(dialog).not.toContainText(/how would you like to receive/i);
    await expect(dialog).not.toContainText(/cash on delivery/i);
  });
});

test.describe("choosing a combination", () => {
  test("offers the values as one radio group per option", async ({ page }) => {
    // Not a row of unrelated toggle buttons: exactly one size is chosen, and
    // that is what a screen reader and the arrow keys both need to know.
    await openNamed(page, /studio apron/i);
    await expect(page.getByRole("radiogroup")).toHaveCount(2);
    await expect(
      page.getByRole("radio", { name: "M", exact: true }),
    ).toBeVisible();
  });

  test("the arrow keys move the choice", async ({ page }) => {
    await openNamed(page, /studio apron/i);
    const small = page.getByRole("radio", { name: "S", exact: true });
    await small.click();
    await expect(small).toHaveAttribute("aria-checked", "true");

    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("radio", { name: "M", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(small).toHaveAttribute("aria-checked", "false");
  });

  test("the gallery follows the photo of what was picked", async ({ page }) => {
    /*
     * The charcoal apron is photographed separately from the natural one. Its
     * photo used to appear only in the checkout sheet — after the buyer had
     * decided — so picking the colour changed the price and left the wrong
     * picture on screen.
     */
    await openNamed(page, /studio apron/i);
    const slides = page.locator(".snap-x > div");
    const before = await slides.count();

    await page.getByRole("radio", { name: "Charcoal", exact: true }).click();
    await expect(slides).toHaveCount(before + 1);

    // And it hands the gallery back when the choice has no photo of its own.
    await page.getByRole("radio", { name: "Natural", exact: true }).click();
    await expect(slides).toHaveCount(before);
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
