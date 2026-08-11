/**
 * Renders one post per template into `scripts/social/.out` without publishing
 * anything. This is the design loop — run it, look at the PNGs, adjust.
 *
 *   npx tsx scripts/social/preview.ts            # one of each template
 *   npx tsx scripts/social/preview.ts --all      # every post in the library
 */
import { chromium } from "@playwright/test";
import { POSTS } from "./content";
import { renderPost, OUT } from "./render";

async function main() {
  const all = process.argv.includes("--all");
  const seen = new Set<string>();
  const picks = POSTS.filter((p) => {
    if (all) return true;
    if (seen.has(p.template)) return false;
    seen.add(p.template);
    return true;
  });

  const browser = await chromium.launch();
  try {
    for (const post of picks) {
      for (const canvas of ["square", "wide"] as const) {
        const path = await renderPost(post, canvas, browser);
        console.log(`${post.template.padEnd(10)} ${canvas.padEnd(6)} ${path}`);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`\n${picks.length * 2} files in ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
