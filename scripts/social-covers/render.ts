/**
 * Renders the social cover images from the HTML compositions beside it.
 *
 * Same philosophy as `scripts/shots.ts`: the covers are evidence, not
 * illustration. Every phone in them is a committed screenshot of a live demo
 * shop from `public/demos/`, so re-run this after `npm run shots` whenever
 * the storefront template changes — a cover showing last year's shop is the
 * marketing page lying, just on someone else's site.
 *
 *   npm run covers
 *
 * Each canvas is authored at 1x in its HTML file and captured at
 * deviceScaleFactor 2, which lands exactly on the platform's recommended
 * upload size. Output goes to `public/brand/social/`.
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const HERE = join(process.cwd(), "scripts", "social-covers");
const OUT = join(process.cwd(), "public", "brand", "social");

/** width/height are the 1x canvas; the shipped file is exactly double. */
const COVERS = [
  { file: "x.html", out: "x-header.png", width: 750, height: 250 },
  { file: "facebook.html", out: "facebook-cover.png", width: 820, height: 312 },
  { file: "linkedin.html", out: "linkedin-cover.png", width: 1128, height: 191 },
  { file: "youtube.html", out: "youtube-banner.png", width: 1280, height: 720 },
  { file: "instagram-post.html", out: "instagram-post.png", width: 540, height: 540 },
  { file: "instagram-story.html", out: "instagram-story.png", width: 540, height: 960 },
] as const;

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();

  for (const cover of COVERS) {
    const context = await browser.newContext({
      viewport: { width: cover.width, height: cover.height },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto(pathToFileURL(join(HERE, cover.file)).href);

    // Fonts first, then every image: a cover with a system-font headline or
    // a blank phone is exactly the kind of half-render that must never ship.
    await page.evaluate(async () => {
      await document.fonts.ready;
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
    });

    const path = join(OUT, cover.out);
    await page.screenshot({ path });
    console.log(`${cover.out}  ${cover.width * 2}x${cover.height * 2}`);
    await context.close();
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
