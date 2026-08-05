import { expect, test } from "@playwright/test";

/**
 * The phone. Most people reach a link-in-bio shop from a phone, so this is the
 * layout that matters most — and the one a desktop-shaped test never sees.
 */

const DEMO = "/demo";

test.describe("on a phone", () => {
  test("the shop fits the screen", async ({ page }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(1);
  });

  test("product cards are laid out, not collapsed", async ({ page }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });
    const card = page.locator("article").first();
    const box = await card.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(100);
    expect(box?.height ?? 0).toBeGreaterThan(100);
  });

  test("the checkout sheet opens inside the viewport", async ({ page }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^buy now$/i }).first().click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    // The sheet was once anchored to a `backdrop-filter` ancestor instead of
    // the viewport, which put it hundreds of pixels above the screen on a
    // phone — visible to a text assertion, invisible to a buyer.
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(-5);
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(-5);
    expect((box?.width ?? 0)).toBeLessThanOrEqual((viewport?.width ?? 0) + 2);
  });

  test("tap targets are big enough to hit", async ({ page }) => {
    await page.goto(DEMO, { waitUntil: "networkidle" });
    const small = await page.locator("article button").evaluateAll((els) =>
      els
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0 && r.height < 32).length,
    );
    expect(small, "buttons under 32px tall").toBe(0);
  });

  test("Arabic reads right to left without overflowing", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: "sailo_locale", value: "ar", url: baseURL ?? "http://localhost:3000" },
    ]);
    await page.goto(DEMO, { waitUntil: "networkidle" });

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
