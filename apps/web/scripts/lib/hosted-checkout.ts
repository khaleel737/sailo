import { chromium } from "playwright";

/**
 * Pays a test-mode Stripe Checkout page with a card that always succeeds.
 *
 * A Checkout Session cannot be completed over the API — the point of the
 * hosted page is that Stripe collects the card, not us. So the only way to
 * prove the path a seller actually walks is to walk it.
 *
 * The shape of that page is not obvious and cost a few wrong guesses:
 *
 *   - card is one item in a payment-method accordion, alongside Cash App and
 *     bank debit. Its fields do not exist in the DOM until the item's radio is
 *     checked, so filling them straight away finds nothing;
 *   - the radio is visually replaced by a styled button, so it needs a forced
 *     check rather than a click;
 *   - the fields then mount into the main document, not the Stripe Elements
 *     iframes you would expect from a custom Payment Element integration.
 *
 * Test mode only: the number below is Stripe's published test Visa and live
 * mode refuses it. Returns false rather than throwing, because a harness that
 * dies here reports nothing about the twenty checks after it.
 */
export async function payHostedCheckout(url: string): Promise<boolean> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });

    // Choose card, then wait for its fields to mount.
    await page
      .locator("#payment-method-accordion-item-title-card")
      .check({ force: true })
      .catch(() => {});
    await page.waitForSelector("#cardNumber", { timeout: 30_000 });

    const expiry = String((new Date().getFullYear() % 100) + 3);
    await page.fill("#cardNumber", "4242424242424242");
    await page.fill("#cardExpiry", `12${expiry}`);
    await page.fill("#cardCvc", "123");

    /* Which of these Stripe renders depends on the account's settings and the
       buyer's inferred country. Name and email are required when present and
       empty — leaving either blank fails the form with a bare "Required", with
       nothing to say which field meant it. */
    for (const [selector, value] of [
      ["#billingName", "Subs Check"],
      ["#email", "subs-check@sailo.local"],
      ["#billingPostalCode", "12345"],
    ] as const) {
      const field = page.locator(selector).first();
      if ((await field.count()) && (await field.inputValue()) === "") {
        await field.fill(value);
      }
    }

    await page.getByTestId("hosted-payment-submit-button").click();

    /*
     * Success means Stripe hands the browser back to `success_url`. It does
     * NOT mean that URL survives: this browser carries no session cookie, so
     * the admin route bounces it straight to /login — which is the app being
     * right, not the payment failing. Waiting for `checkout=success` in the
     * address bar therefore reports a working payment as broken.
     *
     * Leaving checkout.stripe.com is the honest signal. Whether the charge
     * actually landed is Stripe's to answer, and the caller asks it directly
     * by looking for `checkout.session.completed`.
     */
    await page.waitForURL((next) => !next.host.endsWith("checkout.stripe.com"), {
      timeout: 90_000,
    });
    return true;
  } catch {
    return false;
  } finally {
    await browser.close();
  }
}
