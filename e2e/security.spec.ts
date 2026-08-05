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

  test("an unpublished shop is a 404, not a leak", async ({ page }) => {
    const res = await page.goto("/definitely-not-a-shop-xyz");
    expect(res?.status()).toBe(404);
  });
});
