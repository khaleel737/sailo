/**
 * Captures the storefront screenshots the landing page shows.
 *
 * The gallery on `/` is meant to be evidence, not an illustration — so these
 * are real pages rendered by the real app against the seeded demo shops, not
 * mockups drawn to look like them. Re-run it whenever the shop template or the
 * demo data changes, or the marketing page starts quietly lying.
 *
 *   npm run shots                      # against localhost:3000
 *   SHOTS_BASE_URL=… npm run shots     # against a deploy
 *
 * Output lands in `public/demos/` as `<handle>.png` (desktop, 1280×1000) and
 * `<handle>-phone.png` (390×844). Both are committed: the landing page must
 * render on a machine that has never seen a database.
 *
 * Seed first, and restart the server after seeding. The catalogue is cached by
 * tag with no expiry, and a seed script writes straight to the database without
 * bumping the tag — so a running dev server will happily photograph the shop as
 * it was three edits ago.
 */
import { chromium, devices, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = process.env.SHOTS_BASE_URL ?? "http://localhost:3000";
const OUT = join(process.cwd(), "public", "demos");

/** The shops the landing page links to, in the order it shows them. */
const HANDLES = ["demo", "forno", "lumi", "serene", "inkwell"] as const;

/**
 * One shop is captured a second time with the language cookie set, so the
 * "thirty-five languages" section can show the same page reading right-to-left
 * rather than asking anyone to take it on trust.
 */
const RTL_SHOT = { handle: "forno", locale: "ar" } as const;

const DESKTOP = { width: 1280, height: 1000 };
const PHONE = devices["iPhone 14"];

/**
 * Waits for the fold to be genuinely painted. `networkidle` alone returns
 * while product images are still blank, and a gallery of half-loaded shops is
 * worse than no gallery.
 */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    // Nudge lazy images into loading, then wait for every one of them.
    window.scrollTo(0, document.body.scrollHeight);
    window.scrollTo(0, 0);
    await Promise.all(
      Array.from(document.images)
        .filter((img) => !img.complete)
        .map(
          (img) =>
            new Promise((resolve) => {
              img.addEventListener("load", resolve, { once: true });
              img.addEventListener("error", resolve, { once: true });
            }),
        ),
    );
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
  // Let the entrance animations land so nothing is caught mid-fade.
  await page.waitForTimeout(600);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const manifest: { handle: string; width: number; height: number }[] = [];

  try {
    for (const handle of HANDLES) {
      const url = `${BASE}/${handle}`;

      const desktop = await browser.newContext({
        viewport: DESKTOP,
        deviceScaleFactor: 2,
        // Screenshots are a product surface, not a personalised page: pin the
        // language so a translator's machine doesn't produce a German gallery.
        locale: "en-GB",
        reducedMotion: "reduce",
      });
      const page = await desktop.newPage();
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });
      if (!response?.ok()) {
        throw new Error(`${url} returned ${response?.status()} — is the shop seeded?`);
      }
      await settle(page);
      await page.screenshot({ path: join(OUT, `${handle}.png`) });
      await desktop.close();

      const mobile = await browser.newContext({
        ...PHONE,
        deviceScaleFactor: 3,
        locale: "en-GB",
        reducedMotion: "reduce",
      });
      const phone = await mobile.newPage();
      await phone.goto(url, { waitUntil: "domcontentloaded" });
      await settle(phone);
      await phone.screenshot({ path: join(OUT, `${handle}-phone.png`) });
      await mobile.close();

      manifest.push({ handle, ...DESKTOP });
      console.log(`  ✓ /${handle}`);
    }

    const rtl = await browser.newContext({
      ...PHONE,
      deviceScaleFactor: 3,
      locale: "ar",
      reducedMotion: "reduce",
    });
    // The switcher writes this cookie; setting it directly gets the same page
    // the visitor would get, without driving the menu.
    await rtl.addCookies([
      {
        name: "sailo_locale",
        value: RTL_SHOT.locale,
        url: BASE,
      },
    ]);
    const rtlPage = await rtl.newPage();
    await rtlPage.goto(`${BASE}/${RTL_SHOT.handle}`, { waitUntil: "domcontentloaded" });
    await settle(rtlPage);
    await rtlPage.screenshot({ path: join(OUT, `${RTL_SHOT.handle}-rtl-phone.png`) });
    await rtl.close();
    console.log(`  ✓ /${RTL_SHOT.handle} (${RTL_SHOT.locale}, rtl)`);
  } finally {
    await browser.close();
  }

  await writeFile(
    join(OUT, "manifest.json"),
    `${JSON.stringify({ capturedFrom: BASE, shots: manifest }, null, 2)}\n`,
  );
  console.log(`\n${manifest.length * 2} screenshots written to public/demos/`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
