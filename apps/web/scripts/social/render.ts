/**
 * Post art: HTML in, PNG out.
 *
 * The temp HTML is written into this directory rather than a system tmpdir so
 * the relative paths in the templates (`../../public/...`, the shared fonts)
 * resolve exactly as they do for `scripts/social-covers`. It is removed again
 * on the way out unless KEEP_HTML is set, which is the fastest way to debug a
 * canvas — open the file in a browser and the render is right there.
 */
import { chromium, type Browser } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CANVAS, html, type Canvas } from "./templates";
import type { Post } from "./content";

const HERE = join(process.cwd(), "scripts", "social");
export const OUT = join(HERE, ".out");

export async function renderPost(
  post: Post,
  canvas: Canvas,
  browser: Browser,
): Promise<string> {
  await mkdir(OUT, { recursive: true });

  const stem = `${post.id}-${canvas}`;
  const htmlPath = join(HERE, `.render-${stem}.html`);
  const pngPath = join(OUT, `${stem}.png`);
  await writeFile(htmlPath, html(post, canvas), "utf8");

  const { width, height } = CANVAS[canvas];
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  try {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });

    /*
     * Fonts first, then every image. A canvas screenshotted mid-load ships a
     * system-font headline or a blank phone, and unlike a website nobody gets
     * to refresh it — it is already on the feed.
     */
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

    // Any image that resolved to zero width failed to load; better to fail the
    // run than to publish a card with a hole in it.
    const broken = await page.evaluate(
      () =>
        Array.from(document.images)
          .filter((img) => img.naturalWidth === 0)
          .map((img) => img.getAttribute("src") ?? "?"),
    );
    if (broken.length) {
      throw new Error(`Art failed to load: ${broken.join(", ")}`);
    }

    await page.screenshot({ path: pngPath });
    return pngPath;
  } finally {
    await context.close();
    if (!process.env.KEEP_HTML) await rm(htmlPath, { force: true });
  }
}

export async function renderBoth(post: Post): Promise<{ square: string; wide: string }> {
  const browser = await chromium.launch();
  try {
    return {
      square: await renderPost(post, "square", browser),
      wide: await renderPost(post, "wide", browser),
    };
  } finally {
    await browser.close();
  }
}
