import { devices, expect, test } from "@playwright/test";

/**
 * The WhatsApp handoff, on a phone.
 *
 * Reported from a real iPhone: ordering over WhatsApp showed "something went
 * wrong" and *then* opened WhatsApp. Both halves matter — an error alone would
 * be a failed checkout, and a redirect alone would be a working one. Both at
 * once meant an error was being painted over a checkout that had succeeded.
 *
 * It is real, and it is WebKit-only. `createOrderIntent` calls
 * `revalidatePath`, so its Server Action response keeps streaming the
 * re-rendered route after the return value has arrived; assigning
 * `window.location.href` cancels that stream. Chromium calls the cancellation
 * an abort and React ignores it. WebKit rejects it as `TypeError: Load failed`,
 * React treats it as a genuine failure while committing the router update, and
 * the boundary paints in the second before Safari finishes leaving.
 *
 * So the iPhone profile is the test, not a detail of it — this passes on
 * Chromium no matter what the code does. `devices["iPhone 13"]` selects WebKit,
 * which is the engine on every browser on iOS.
 *
 * Needs the local scenario database and `seed-whatsapp.scenario.ts`.
 */
test.use({ ...devices["iPhone 13"] });

// Writing the order is a real round trip through a real database, and the
// sampling below deliberately waits for it rather than assuming a duration.
test.setTimeout(120_000);

test("ordering over WhatsApp leaves the page without showing an error", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  /*
   * wa.me is never actually loaded, but the navigation is *held open* rather
   * than failed fast. A real phone spends a second or two on this hop, and
   * that window — where the old page is still on screen — is the entire bug.
   * Aborting immediately blanks the page and hides what we came to see.
   */
  /*
   * A box rather than a bare `let`, because the write happens in the route
   * handler and the read happens in a poll loop below. Neither the linter nor
   * the compiler can connect those across a callback: one calls the loop
   * condition unmodified, the other narrows the variable to `null` at every
   * use. A property is opaque to both, and it is honest about what this is —
   * a slot the browser fills in at some point while the loop watches it.
   */
  const handoff: { url: string | null } = { url: null };
  await page.route("https://wa.me/**", async (route) => {
    handoff.url = route.request().url();
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    await route.abort();
  });

  await page.goto("/wa-repro/p/blue-hoodie");
  await expect(page.getByRole("heading", { name: "Blue Hoodie" })).toBeVisible();

  // Straight to the buy sheet — the route a buyer takes on a phone.
  await page.getByRole("button", { name: /^buy now$/i }).first().click();
  const name = page.locator('input[name="customerName"]');
  await expect(name).toBeVisible({ timeout: 20_000 });

  await name.fill("Ada Buyer");
  await page.locator('input[name="customerPhone"]').fill("+15551234567");
  await page.getByRole("button", { name: /order on whatsapp/i }).click();

  /*
   * Sampled, not checked once at the end. The error was never the final state
   * — it appeared, and then the browser left. A single assertion after the
   * dust settles is exactly the shape of test that reported this as passing.
   *
   * Paced off the handoff rather than a fixed number of ticks. The order has
   * to be written before any of this happens, and a cold dev server has taken
   * twenty seconds over it — a fixed window expired first and the test failed
   * claiming no navigation, which was true and beside the point. So: sample
   * until the navigation starts, then keep sampling through the window where
   * the old page is still on screen, which is where the error used to be.
   */
  const screens: string[] = [];
  const sample = async () => {
    const text = await page.locator("body").innerText().catch(() => "");
    const seen = text.replace(/\s+/g, " ").trim();
    if (!screens.includes(seen)) screens.push(seen);
  };

  for (let i = 0; i < 160 && handoff.url === null; i++) {
    await page.waitForTimeout(250);
    await sample();
  }
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(250);
    await sample();
  }

  // The screens go in the message: "no navigation" on its own cannot tell a
  // checkout that refused from one that was simply still working.
  expect(
    handoff.url,
    `no WhatsApp navigation was attempted. Screens seen:\n${screens
      .map((s) => `  - ${s.slice(0, 200) || "(blank)"}`)
      .join("\n")}`,
  ).toBeTruthy();
  expect(
    screens.find((s) => /something went wrong/i.test(s)),
    "an error was painted over a checkout that succeeded",
  ).toBeUndefined();

  /*
   * Reported, not asserted, and the distinction is the whole point of the bug.
   *
   * Whether the stream is still open when the navigation starts is a race: win
   * it and nothing is cancelled and nothing rejects, lose it and WebKit raises
   * `TypeError: Load failed`. Both happen here from run to run. That race is
   * precisely why the report was "sometimes" rather than "always", and why an
   * assertion on it would be a test that fails for the reason it was written
   * to prove. What must hold is above: the handoff happens, and the buyer is
   * never shown an error for it.
   */
  console.log(
    pageErrors.some((m) => /load failed/i.test(m))
      ? "note: the revalidation stream was cancelled this run (suppressed)"
      : "note: the revalidation stream completed before the handoff this run",
  );
});
