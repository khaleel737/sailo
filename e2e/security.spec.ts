import { expect, test } from "@playwright/test";

/**
 * Security headers, asserted against a running server rather than against the
 * config that is supposed to produce them. A header only protects anyone if it
 * is actually on the response.
 */
test.describe("security headers", () => {
  test("a Content-Security-Policy is served", async ({ request }) => {
    const res = await request.get("/demo");
    const csp = res.headers()["content-security-policy"];
    expect(csp, "no CSP — an XSS on a payment page would be unbounded").toBeTruthy();
  });

  test("the CSP allows Stripe and nothing else it doesn't need", async ({ request }) => {
    const csp = (await request.get("/demo")).headers()["content-security-policy"] ?? "";
    expect(csp).toContain("https://js.stripe.com");
    expect(csp).toContain("https://api.stripe.com");
    // A wildcard default would make the rest of the policy decorative.
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain("default-src *");
    expect(csp).toContain("object-src 'none'");
  });

  test("the site refuses to be framed", async ({ request }) => {
    // Clickjacking an admin page is how a seller's shop gets taken down.
    const headers = (await request.get("/demo")).headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  test("sniffing and referrer leakage are shut off", async ({ request }) => {
    const headers = (await request.get("/demo")).headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("HSTS is declared", async ({ request }) => {
    const hsts = (await request.get("/demo")).headers()["strict-transport-security"];
    expect(hsts).toContain("max-age=");
    expect(Number(/max-age=(\d+)/.exec(hsts ?? "")?.[1] ?? 0)).toBeGreaterThan(31_536_000);
  });

  test("headers reach the admin and the API too", async ({ request }) => {
    for (const path of ["/login", "/api/cron/sweep"]) {
      const csp = (await request.get(path)).headers()["content-security-policy"];
      expect(csp, `${path} has no CSP`).toBeTruthy();
    }
  });
});

test.describe("routes that must refuse", () => {
  test("the admin is not reachable signed out", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
  });

  for (const path of ["/admin/orders", "/admin/settings", "/admin/payments"]) {
    test(`${path} redirects a stranger to sign in`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    });
  }

  test("the Stripe webhook refuses an unsigned payload", async ({ request }) => {
    expect((await request.post("/api/stripe/webhook", { data: {} })).status()).toBe(400);
  });

  test("the cron endpoint refuses a forged user-agent", async ({ request }) => {
    const res = await request.get("/api/cron/sweep", {
      headers: { "user-agent": "vercel-cron/1.0" },
    });
    expect(res.status()).toBe(401);
  });

  /*
   * A handle nobody owns must not tell anyone whether it could be owned.
   *
   * This used to assert a 404 status and failed against a correct app. The
   * route renders `notFound()` from inside the Suspense boundary that
   * `[handle]/loading.tsx` creates, and Next has already flushed the shell —
   * and with it the 200 — by the time that runs. Next's own documentation
   * calls this out and injects `<meta name="robots" content="noindex">` to
   * keep the soft 404 out of search results; returning a real 404 would mean
   * checking the handle before the response streams, which costs the shop page
   * its loading UI on the most-visited route in the product.
   *
   * So the status code is the trade-off, not the security property. What
   * matters is that the response is identical whether or not the handle is
   * merely unpublished, and that it is not indexable.
   */
  test("an unknown shop reveals nothing and is not indexable", async ({ page }) => {
    const res = await page.goto("/definitely-not-a-shop-xyz", { waitUntil: "networkidle" });
    /*
     * Wait for the copy, not for the network.
     *
     * `networkidle` says the requests stopped; it does not say React finished
     * streaming into the boundary. Under a loaded dev server this read an
     * empty body often enough to fail the comparison below on its own —
     * a flake that fails a *security* test for a rendering reason, which is
     * the worst kind, because it trains you to re-run rather than to look.
     */
    await expect(page.locator("body")).toContainText(/doesn.t exist|not found/i);
    const body = await page.content();
    const visible = await page.locator("body").innerText();

    expect(body).toMatch(/not found/i);
    // Checked before the second navigation below, which moves page.url().
    expect(new URL(page.url()).pathname).toBe("/definitely-not-a-shop-xyz");

    /*
     * The noindex tag is what stops a soft 404 becoming a search result.
     *
     * Asserted across every match rather than on a single one: a streamed
     * response carries the tag twice, once in the head and once inlined into
     * the body where the boundary resolved. Both must say noindex — one
     * saying otherwise would undo the other.
     */
    const robots = page.locator('meta[name="robots"]');
    const tags = await robots.count();
    expect(tags).toBeGreaterThan(0);
    for (let i = 0; i < tags; i++) {
      await expect(robots.nth(i)).toHaveAttribute("content", /noindex/);
    }
    // Whatever the status, it must never be a redirect to somewhere real.
    expect(res?.status()).toBeLessThan(400);

    /*
     * A second, different unknown handle — because one request cannot show the
     * property this test is named for.
     *
     * The previous version fetched a single handle and then asserted, in a
     * comment, that the response was indistinguishable from another's. It
     * never compared anything, so a regression that leaked a real shop's name
     * or a different status on one handle would have kept it green.
     *
     * Compared on what a visitor can see rather than on the HTML: the dev
     * server injects per-request HMR and devtools chunks, so `page.content()`
     * differs between two identical pages and can never assert this.
     */
    const other = await page.goto("/definitely-not-a-shop-abc", { waitUntil: "networkidle" });
    await expect(page.locator("body")).toContainText(/doesn.t exist|not found/i);
    const otherVisible = await page.locator("body").innerText();

    expect(otherVisible.replace(/definitely-not-a-shop-abc/g, "X")).toBe(
      visible.replace(/definitely-not-a-shop-xyz/g, "X"),
    );
    expect(other?.status()).toBe(res?.status());
    expect(new URL(page.url()).pathname).toBe("/definitely-not-a-shop-abc");
  });
});
