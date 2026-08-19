import { expect, test, type Page } from "@playwright/test";

/**
 * The product form, driven the way a seller drives it.
 *
 * The kind used to be a `<select>` and the fields it governed appeared a
 * screen and a half below it. It is a tablist now, and three things about
 * that are worth a browser rather than a unit test:
 *
 *   - only one kind can be chosen, and — the part that matters on the server —
 *     the panels that are not chosen are *not in the DOM*, so their inputs
 *     cannot reach the `FormData`;
 *   - the tablist is operable from the keyboard, which no other check sees;
 *   - each kind's own settings actually save and come back.
 *
 * Writes rows, so it runs under the same two latches as `journey.spec.ts`:
 * localhost, and `E2E_ALLOW_WRITES=1` with the server pointed at a throwaway
 * database.
 */

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

const LOCAL = (() => {
  try {
    const host = new URL(BASE).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
})();

test.skip(!LOCAL, "writes real rows — localhost only");
test.skip(
  process.env.E2E_ALLOW_WRITES !== "1",
  "writes rows through the dev server's DATABASE_URL — set E2E_ALLOW_WRITES=1 with the server pointed at a throwaway database",
);

const stamp = Date.now().toString(36);
const seller = {
  // The handle is derived from the name, and a rerun must not collide with the
  // shop the last one claimed.
  name: `Kinds ${stamp}`,
  email: `kinds-${stamp}@example.com`,
  password: "correct-horse-battery",
};

async function dismissConsent(page: Page) {
  const accept = page.getByRole("button", { name: /^accept$/i }).first();
  if (await accept.count()) await accept.click().catch(() => {});
}

/** The shop's handle, claimed during onboarding and needed by the storefront. */
let handle = "";

async function signUpAndOnboard(page: Page) {
  await page.goto("/signup");
  await dismissConsent(page);
  await page.locator("#name").fill(seller.name);
  await page.locator("#email").fill(seller.email);
  await page.locator("#password").fill(seller.password);
  await page.getByRole("button", { name: /create my shop/i }).click();
  await page.waitForURL(/\/(onboarding|admin)/, { timeout: 60_000 });

  // Onboarding is three steps; the last one's button is "Create my shop".
  for (let step = 0; step < 6; step++) {
    if (/\/admin/.test(page.url())) break;
    await dismissConsent(page);
    const next = page
      .getByRole("button", { name: /^(continue|finish|done|go to|open|create my shop)/i })
      .first();
    if (!(await next.count())) break;
    // The handle step checks availability before it enables Continue.
    await expect(next).toBeEnabled({ timeout: 20_000 });
    await next.click();
    await page.waitForTimeout(2500);
  }
  await page.waitForURL(/\/admin/, { timeout: 60_000 });

  /*
   * The handle, read from the panel rather than from the onboarding field.
   *
   * That field is prefilled from the name by the client after hydration, so
   * reading it on arrival returns an empty string — which then built a
   * storefront URL of `//p/…`, and a protocol-relative URL sends the browser
   * to a host called `p`. The panel's own link to the shop is the value the
   * server actually stored, including the `-2` a handle collision would add.
   */
  const href =
    (await page.getByRole("link", { name: /view shop/i }).first().getAttribute("href")) ?? "";
  handle = new URL(href, BASE).pathname.split("/").filter(Boolean)[0] ?? "";
  expect(handle, "onboarding never produced a handle").toBeTruthy();
}

/** The tab for a kind, by its accessible name. */
const tab = (page: Page, name: RegExp) =>
  page.getByRole("tab", { name });

test.describe.configure({ mode: "serial" });

test.describe("choosing what to sell", () => {
  test.slow();
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    // Signup plus three onboarding steps, each a round trip through a dev
    // server compiling the route it is being asked for. The default minute is
    // not enough on a cold start.
    test.setTimeout(180_000);
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await signUpAndOnboard(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("offers all five kinds as tabs, with exactly one chosen", async () => {
    await page.goto("/admin/products/new");
    await dismissConsent(page);

    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(5);
    // One selected, never two — the whole point of the control.
    await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
    await expect(tab(page, /^physical$/i)).toHaveAttribute("aria-selected", "true");

    // And the form posts that choice.
    await expect(page.locator('input[name="kind"]')).toHaveValue("physical");
  });

  test("shows only the chosen kind's fields, and leaves the rest out of the DOM", async () => {
    await page.goto("/admin/products/new");
    await dismissConsent(page);

    // Physical: no event date anywhere, so nothing can post one.
    await expect(page.locator("#eventStartsAt")).toHaveCount(0);
    await expect(page.locator("#digitalLinkUrl")).toHaveCount(0);
    await expect(page.locator("#durationMinutes")).toHaveCount(0);

    await tab(page, /^event$/i).click();
    await expect(page.locator("#eventStartsAt")).toBeVisible();
    await expect(page.locator("#eventEndsAt")).toBeVisible();
    await expect(page.locator('input[name="kind"]')).toHaveValue("event");
    await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);

    await tab(page, /^service$/i).click();
    // The event's fields are gone, not hidden.
    await expect(page.locator("#eventStartsAt")).toHaveCount(0);
    await expect(page.locator("#durationMinutes")).toBeVisible();

    await tab(page, /^membership$/i).click();
    await expect(page.locator("#durationMinutes")).toHaveCount(0);
    // A membership is one thing at one price: no strike-through, no stock.
    await expect(page.locator("#compareAtPrice")).toHaveCount(0);
    await expect(page.locator('input[name="trackInventory"]')).toHaveCount(0);
  });

  test("moves between kinds from the keyboard", async () => {
    await page.goto("/admin/products/new");
    await dismissConsent(page);

    await tab(page, /^physical$/i).focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab(page, /^digital$/i)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('input[name="kind"]')).toHaveValue("digital");

    await page.keyboard.press("End");
    await expect(tab(page, /^membership$/i)).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Home");
    await expect(tab(page, /^physical$/i)).toHaveAttribute("aria-selected", "true");
    // Roving tabindex: the row is one tab stop, not five.
    await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  });

  test("a digital product can be delivered as a link instead of a file", async () => {
    await page.goto("/admin/products/new");
    await dismissConsent(page);
    await tab(page, /^digital$/i).click();

    // Files by default, with the download terms that only files can have.
    const shapes = page.getByRole("radio");
    await expect(shapes).toHaveCount(3);
    await expect(page.locator("#downloadLimit")).toBeVisible();

    await page.getByRole("radio", { name: /link/i }).click();
    await expect(page.locator("#digitalLinkUrl")).toBeVisible();
    // A link is not proxied, so there is nothing to count or expire.
    await expect(page.locator("#downloadLimit")).toHaveCount(0);
    await expect(page.locator("#digitalAccessDetails")).toHaveCount(0);

    await page.getByRole("radio", { name: /^code/i }).click();
    await expect(page.locator("#digitalAccessDetails")).toBeVisible();
    await expect(page.locator("#digitalLinkUrl")).toHaveCount(0);

    // Blank is refused rather than saved as a buy button leading nowhere.
    await page.locator("#title").fill(`Studio invite ${stamp}`);
    await page.locator("#price").fill("12.00");
    await page.getByRole("button", { name: /add product/i }).click();
    await expect(page.locator("body")).toContainText(/code or joining details/i);

    await page.locator("#digitalAccessDetails").fill("Discord: https://discord.gg/abc123");
    await page.getByRole("button", { name: /add product/i }).click();
    await expect(page.locator("body")).toContainText(/product added/i);
  });

  test("a membership can be billed on a cycle that is not monthly or yearly", async () => {
    await page.goto("/admin/products/new");
    await dismissConsent(page);
    await tab(page, /^membership$/i).click();

    await expect(page.locator('input[name="billingInterval"]')).toHaveValue("month");
    await page.getByRole("radio", { name: /custom/i }).click();

    await page.locator("#intervalCount").fill("3");
    await page.locator("#intervalUnit").selectOption("month");
    await expect(page.locator('input[name="billingIntervalCount"]')).toHaveValue("3");

    await page.locator("#title").fill(`Quarterly club ${stamp}`);
    await page.locator("#price").fill("60.00");
    await page.getByRole("button", { name: /add product/i }).click();
    await expect(page.locator("body")).toContainText(/product added/i);
  });

  test("an event keeps its start, its end and its per-order limit", async () => {
    await page.goto("/admin/products/new");
    await dismissConsent(page);
    await tab(page, /^event$/i).click();

    await page.locator("#title").fill(`Warehouse night ${stamp}`);
    await page.locator("#price").fill("18.00");
    await page.locator("#eventStartsAt").fill("2026-11-20T19:00");
    await page.locator("#eventEndsAt").fill("2026-11-20T23:00");
    await page.locator("#maxPerOrder").fill("4");

    await page.getByRole("button", { name: /add product/i }).click();
    await expect(page.locator("body")).toContainText(/product added/i);

    // And it comes back on the tab it was saved on, with its own values.
    await page.goto("/admin/products");
    await page.getByRole("link", { name: new RegExp(`Warehouse night ${stamp}`, "i") }).first().click();
    await page.waitForURL(/\/admin\/products\/[0-9a-f-]{36}/);
    await expect(tab(page, /^event$/i)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#eventStartsAt")).toHaveValue("2026-11-20T19:00");
    await expect(page.locator("#eventEndsAt")).toHaveValue("2026-11-20T23:00");
    await expect(page.locator("#maxPerOrder")).toHaveValue("4");
  });

  test("refuses an event that ends before it starts", async () => {
    await page.goto("/admin/products/new");
    await dismissConsent(page);
    await tab(page, /^event$/i).click();

    await page.locator("#title").fill(`Backwards night ${stamp}`);
    await page.locator("#price").fill("10.00");
    await page.locator("#eventStartsAt").fill("2026-11-20T19:00");
    /*
     * Past the picker's own `min`, which the browser would otherwise refuse
     * before the form is ever submitted. Dropping the attribute is how a
     * client that does not honour it — the phone posting JSON, a script —
     * reaches the server, and the server check is what has to catch it.
     */
    await page.locator("#eventEndsAt").evaluate((el: HTMLInputElement) => {
      el.removeAttribute("min");
      el.value = "2026-11-20T17:00";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await page.getByRole("button", { name: /add product/i }).click();
    await expect(page.locator("body")).toContainText(/end has to come after/i);
  });
});
