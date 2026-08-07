import { expect, test } from "@playwright/test";

/**
 * What the chart looks like, checked against a committed baseline.
 *
 * Every rendering fault this component has had was found by looking at it:
 * bars and a line drawn in one frame, an axis label clipped to "ul 8", a
 * one-day window rendering a slab half the width of its card, a confident line
 * along the baseline of a shop with no sales, "1 days". None of them fail a
 * type check or a unit test, and all of them reached a screenshot before they
 * reached anyone's attention. These are those screenshots, kept.
 *
 * Fixtures live at `/dev/charts` — fixed dates, seeded values, no clock and no
 * locale, so the picture only changes when the code does.
 *
 * When a diff is real, look at it before accepting it:
 *   npx playwright test e2e/charts.spec.ts --update-snapshots
 */

const CASES = [
  "steady",
  "traffic",
  "refund-spike",
  "refunds-only",
  "cent-beside-fortune",
  "empty",
  "single-day",
  "flat-week",
  "year",
] as const;

/*
 * Animations off, and the pointer parked away from the plot. The bars carry a
 * 150ms opacity transition and the cursor changes what the readout says, so a
 * stray pointer or a half-finished transition would make the baseline a
 * coin toss.
 */
const SHOT = { animations: "disabled" } as const;

test.describe("chart fixtures", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dev/charts");
    await page.waitForSelector("[data-case] svg", { timeout: 60_000 });
    // ParentSize measures after mount, so the first paint has no plot in it.
    await expect(page.locator("[data-case] svg").first()).toBeVisible();
    await page.mouse.move(0, 0);
  });

  for (const id of CASES) {
    test(`${id} renders as expected`, async ({ page }) => {
      const card = page.locator(`[data-case="${id}"]`);
      await expect(card).toHaveScreenshot(`${id}.png`, SHOT);
    });
  }
});

test.describe("chart interaction", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dev/charts");
    await page.waitForSelector("[data-case] svg", { timeout: 60_000 });
    await page.mouse.move(0, 0);
  });

  test("pointing at a day moves the readout off window totals", async ({ page }) => {
    const card = page.locator('[data-case="steady"]');
    const readout = card.locator("dl");
    await expect(readout).toContainText("30 days");

    // visx nests an <svg> inside every axis tick label, so a card holds
    // several — the plot is the outermost one.
    const box = await card.locator("svg").first().boundingBox();
    if (!box) throw new Error("the chart svg has no box to point at");
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);

    // The period label becomes a date, which is the whole reason the disclosure
    // table was removed.
    await expect(readout).not.toContainText("30 days");
    await expect(card).toHaveScreenshot("steady-pointed.png", SHOT);
  });

  test("the shape switch redraws every series, never a mix", async ({ page }) => {
    const card = page.locator('[data-case="steady"]');
    // Bars by default: one <rect> per day per drawn series, no <path>.
    await expect(card.locator("svg path")).toHaveCount(0);

    await card.getByText("Line", { exact: true }).click();
    await page.mouse.move(0, 0);

    // Lines now, and no bars left behind — the fault that started this test.
    await expect(card.locator("svg path")).not.toHaveCount(0);
    await expect(card).toHaveScreenshot("steady-as-line.png", SHOT);
  });

  test("an empty shop offers no shape to switch", async ({ page }) => {
    const card = page.locator('[data-case="empty"]');
    await expect(card.getByText("Line", { exact: true })).toHaveCount(0);
  });
});

test.describe("chart on a phone", () => {
  /*
   * The phone's characteristics, not `devices["iPhone 14"]` — that preset also
   * names a browser, which cannot be switched inside a describe. What matters
   * here is a coarse pointer and a narrow viewport, and both are set directly.
   */
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });

  test("a tap reads a day, and the reading survives the finger lifting", async ({
    page,
  }) => {
    await page.goto("/dev/charts");
    await page.waitForSelector("[data-case] svg", { timeout: 60_000 });

    const card = page.locator('[data-case="steady"]');
    const readout = card.locator("dl");
    await expect(readout).toContainText("30 days");

    const box = await card.locator("svg").first().boundingBox();
    if (!box) throw new Error("the chart svg has no box to tap");
    await page.touchscreen.tap(box.x + box.width * 0.6, box.y + box.height / 2);

    /*
     * The bug this pins: a lifted finger used to clear the cursor, so a tap
     * showed the day for as long as the tap lasted and then went back to
     * totals — which is to say, it did nothing at all.
     */
    await expect(readout).not.toContainText("30 days");
    await expect(card).toHaveScreenshot("steady-touch.png", SHOT);
  });

  test("no slider is rendered under the chart", async ({ page }) => {
    await page.goto("/dev/charts");
    await page.waitForSelector("[data-case] svg", { timeout: 60_000 });

    /*
     * The range input carries keyboard and screen-reader access and must never
     * become visible — an earlier build unhid it on touch, which is not what a
     * chart should look like.
     *
     * Measured rather than asserted with `toBeVisible`: an `sr-only` element is
     * clipped to a single pixel but still laid out, which Playwright counts as
     * visible. The question is whether a seller can see it, so ask its size.
     */
    const slider = page.locator('[data-case="steady"] input[type="range"]');
    await expect(slider).toHaveCount(1);
    const box = await slider.boundingBox();
    if (!box) throw new Error("the slider has no box to measure");
    expect(box.width).toBeLessThanOrEqual(1);
    expect(box.height).toBeLessThanOrEqual(1);
  });
});
