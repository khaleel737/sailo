/**
 * Reports how much of the admin each locale actually covers.
 *
 * Admin translations are merged over English key by key, so a missing string
 * shows an English word rather than a blank — which is safe, but invisible.
 * This makes it countable.
 *
 *   npm run check:i18n
 */
import { LOCALES } from "../src/i18n/config";
import { adminCoverage } from "../src/i18n/admin";
import { en } from "../src/i18n/dictionaries/en";
import { getDictionary } from "../src/i18n";

let storefrontGaps = 0;

/** The storefront dictionary is typed complete, so this only catches empties. */
function countEmpty(obj: Record<string, unknown>, path = ""): number {
  let n = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") {
      if (!v.trim()) {
        console.log(`  empty: ${path}${k}`);
        n += 1;
      }
    } else if (v && typeof v === "object") {
      n += countEmpty(v as Record<string, unknown>, `${path}${k}.`);
    }
  }
  return n;
}

console.log("Storefront");
for (const locale of LOCALES) {
  const empties = countEmpty(getDictionary(locale.code) as unknown as Record<string, unknown>);
  storefrontGaps += empties;
}
const storefrontKeys = JSON.stringify(en).match(/"/g)!.length / 4;
console.log(`  ${LOCALES.length} locales, ~${Math.round(storefrontKeys)} keys each, ${storefrontGaps} empty\n`);

console.log("Admin");
const rows = LOCALES.filter((l) => l.code !== "en").map((l) => ({
  locale: l.code,
  ...adminCoverage(l.code),
}));
const total = rows[0]?.total ?? 0;
console.log(`  ${total} keys in the English source\n`);

for (const r of rows.sort((a, b) => b.translated - a.translated)) {
  const pct = Math.round((r.translated / r.total) * 100);
  const bar = "█".repeat(Math.round(pct / 5)).padEnd(20, "·");
  console.log(
    `  ${r.locale.padEnd(3)} ${bar} ${String(pct).padStart(3)}%  ${r.translated}/${r.total}`,
  );
}

const worst = Math.min(...rows.map((r) => r.translated));
console.log(
  `\n  Every locale falls back to English for what it hasn't got, so the admin is never blank.`,
);
console.log(`  Least covered locale: ${worst}/${total} keys.`);

if (storefrontGaps > 0) {
  console.error(`\n${storefrontGaps} empty storefront strings — that would render blank.`);
  process.exit(1);
}
