/**
 * Reports how much of the admin each locale actually covers.
 *
 * Admin translations are merged over English key by key, so a missing string
 * shows an English word rather than a blank — which is safe, but invisible.
 * This makes it countable.
 *
 *   npm run check:i18n
 */
import { LOCALES } from "@sailo/i18n/config";
import { adminCoverage } from "@sailo/i18n/admin";
import { en } from "@sailo/i18n/dictionaries/en";
import { getDictionary } from "@sailo/i18n";
import { marketingEn } from "@sailo/i18n/marketing/en";
import { getMarketingDictionary } from "@sailo/i18n/marketing";

let storefrontGaps = 0;
let marketingGaps = 0;

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
const storefrontKeys = (JSON.stringify(en).match(/"/g)?.length ?? 0) / 4;
console.log(`  ${LOCALES.length} locales, ~${Math.round(storefrontKeys)} keys each, ${storefrontGaps} empty\n`);

/**
 * The landing page is typed complete like the storefront, so this catches
 * empties — and copy-paste, which the type system can't: a leaf still holding
 * its English source string means that locale was never actually translated.
 */
console.log("Landing page");
const untranslated: string[] = [];
for (const locale of LOCALES) {
  const dict = getMarketingDictionary(locale.code) as unknown as Record<string, unknown>;
  marketingGaps += countEmpty(dict);
  if (locale.code === "en") continue;
  const same = countIdentical(marketingEn as unknown as Record<string, unknown>, dict);
  if (same > 0) untranslated.push(`${locale.code}:${same}`);
}
const marketingKeys = (JSON.stringify(marketingEn).match(/"/g)?.length ?? 0) / 4;
console.log(
  `  ${LOCALES.length} locales, ~${Math.round(marketingKeys)} keys each, ${marketingGaps} empty`,
);
console.log(
  untranslated.length
    ? `  still English: ${untranslated.join(" ")}\n`
    : `  no leaf still holds its English source string\n`,
);

/** Leaves that are byte-identical to English — untranslated, not coincidence. */
function countIdentical(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
): number {
  let n = 0;
  for (const [k, v] of Object.entries(source)) {
    const other = target[k];
    if (typeof v === "string") {
      // Short shared tokens ("Sailo", "Pro") legitimately match; ignore them.
      if (v.length > 24 && v === other) n += 1;
    } else if (v && typeof v === "object" && other && typeof other === "object") {
      n += countIdentical(v as Record<string, unknown>, other as Record<string, unknown>);
    }
  }
  return n;
}

console.log("Admin");
const rows = LOCALES.filter((l) => l.code !== "en").map((l) => ({
  locale: l.code,
  ...adminCoverage(l.code),
}));
const total = rows[0]?.total ?? 0;
console.log(`  ${total} keys in the English source\n`);

for (const r of rows.toSorted((a, b) => b.translated - a.translated)) {
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

if (storefrontGaps + marketingGaps > 0) {
  console.error(
    `\n${storefrontGaps + marketingGaps} empty strings — those would render blank.`,
  );
  process.exit(1);
}
