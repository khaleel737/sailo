/**
 * `npm run check:i18n` — what 35 locales are missing, and whether it matters.
 *
 * Part of the verification gate in `RELEASE-PLAN-2026-08.md`. Decision A chose
 * machine translation on merge with a protected glossary, and this is the half
 * that says what there is to do: it reads every dictionary, diffs each against
 * English, and prints a report that separates a build failure from a backlog.
 *
 * Exits non-zero only on a *storefront* hole. Those already fail `tsc` —
 * `dictionaries/*.ts` are typed as the complete `Dictionary` — so this is the
 * legible version of a failure that was going to happen anyway. Admin holes fall
 * back to English at runtime and are reported rather than enforced, which is
 * Decision A working as chosen: a gate that failed on admin debt would be the
 * thing blocking the release it exists to unblock.
 *
 *   npx tsx scripts/i18n/check.mts            # the report
 *   npx tsx scripts/i18n/check.mts --json     # the same, for a pipeline
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSectionsExist,
  flatten,
  foreignScripts,
  gapsFor,
  passes,
  render,
  summarise,
  type LocaleGap,
  type Surface,
  type SurfaceReport,
} from "../../packages/i18n/src/tooling/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const I18N = join(HERE, "../../packages/i18n/src");

/** Where each surface's files live, and what the export in one is called. */
const SURFACES: Record<Surface, { dir: string; exportName: (locale: string) => string }> = {
  storefront: {
    dir: join(I18N, "dictionaries"),
    exportName: (locale) => locale,
  },
  admin: {
    dir: join(I18N, "admin"),
    // `adminDe`, `adminZh` — the admin files namespace their export.
    exportName: (locale) => `admin${locale[0]!.toUpperCase()}${locale.slice(1)}`,
  },
};

/**
 * Every locale in a surface, read from the directory rather than from a list.
 *
 * A hardcoded list is the one way this check can pass while a locale is
 * untranslated: add `hi.ts`, forget the list, and the report never mentions it.
 * The directory cannot be forgotten.
 */
function localesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => name.replace(/\.ts$/, ""))
    .filter((name) => name !== "index" && name !== "en" && !name.endsWith(".test"))
    .sort();
}

async function loadDictionary(
  dir: string,
  locale: string,
  exportName: string,
): Promise<unknown> {
  const module = (await import(join(dir, `${locale}.ts`))) as Record<string, unknown>;
  const value = module[exportName];
  if (!value) {
    throw new Error(
      `${locale}.ts does not export \`${exportName}\`. Either the file is named ` +
        `for a locale it does not hold, or the export was renamed — both make ` +
        `this locale invisible to every check in the pipeline.`,
    );
  }
  return value;
}

async function reportFor(surface: Surface): Promise<SurfaceReport> {
  const { dir, exportName } = SURFACES[surface];
  const english = flatten(
    await loadDictionary(dir, "en", exportName("en")),
    surface,
  );

  // A protected section renamed away is a money surface silently unprotected.
  assertSectionsExist(surface, [
    ...new Set(Object.keys(english).map((key) => key.split(".")[0]!)),
  ]);

  const gaps: LocaleGap[] = [];
  for (const locale of localesIn(dir)) {
    const target = flatten(
      await loadDictionary(dir, locale, exportName(locale)),
      surface,
    );
    gaps.push(gapsFor(english, target, locale));

    /*
     * A value that strayed into another alphabet. Reported as found rather than
     * gathered into the summary, because it is not debt — it is a string already
     * shipped to readers who cannot parse it.
     */
    for (const bad of foreignScripts(locale, target)) {
      strays.push(`${surface}/${locale} ${bad.key}: ${bad.found} "${bad.characters}"`);
    }
  }
  return summarise(surface, gaps);
}

/** Values in the wrong alphabet, collected across both surfaces. */
const strays: string[] = [];

const json = process.argv.includes("--json");
const reports = [await reportFor("storefront"), await reportFor("admin")];

if (json) {
  console.log(JSON.stringify(reports, null, 2));
} else {
  for (const line of render(reports)) console.log(line);
  console.log("");
  console.log(
    passes(reports)
      ? "check:i18n — no storefront holes. Admin debt above is reported, not enforced."
      : "check:i18n — FAILED. A storefront dictionary is missing keys; these are " +
          "compile errors, so `tsc` will refuse the build too.",
  );
}

if (strays.length > 0 && !json) {
  console.log("");
  console.log(`${strays.length} value(s) in an alphabet the locale does not use:`);
  for (const s of strays) console.log(`  ${s}`);
}

/*
 * A stray script fails. Unlike admin debt — which renders as English and is
 * merely untranslated — this renders as characters the reader cannot parse, in
 * a language they were promised. A defect, not a backlog entry.
 */
process.exit(passes(reports) && strays.length === 0 ? 0 : 1);
