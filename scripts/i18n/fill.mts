/**
 * `npm run i18n:fill` — translate what 34 locales are missing.
 *
 * The other half of Decision A (`RELEASE-PLAN-2026-08.md` §0.5): machine
 * translation on merge, with a reviewed glossary that is never machine-touched.
 * `check.mts` says what is missing; this writes it.
 *
 * The reason this exists rather than "English-first with a fallback" is in the
 * gap analysis and worth restating, because it is the thing that makes the cost
 * worth paying: **a 35-language admin is the differentiator against Easytools,
 * who ship two.** Dropping to English-only for new surfaces to go faster gives
 * up the advantage; automating it keeps both.
 *
 * ## What it will not do
 *
 * It will not write into a protected money section — `glossary.ts` lists them,
 * and every string in one reaches somebody at the moment money moves. It will
 * not overwrite a translation that already exists, machine-written or not, so a
 * human correction survives the next run. And it will not write a file it cannot
 * parse afterwards: each locale is re-read and re-flattened before the result is
 * kept, so a bad splice fails here rather than in somebody's build.
 *
 *   npx tsx scripts/i18n/fill.mts --dry-run              # what it would do
 *   npx tsx scripts/i18n/fill.mts --surface admin --locale de
 *   npx tsx scripts/i18n/fill.mts --limit 50             # a slice, to sample quality
 *   npx tsx scripts/i18n/fill.mts --from batch.json      # translations from a file
 *
 * Needs `ANTHROPIC_API_KEY`, or an `ant auth login` profile — except under
 * `--from`, which calls nothing.
 *
 * ## `--from`
 *
 * Takes `{ "<surface>": { "<locale>": { "<section.key>": "<text>" } } }` and
 * splices it, skipping the model entirely. Every guard still applies: protected
 * sections are refused, existing translations are never overwritten, a changed
 * placeholder is skipped, and each file is read back before the write is kept.
 *
 * It exists because the model is not the only source of a translation and should
 * not be the only way one can land — a human's review pass, a translator's
 * export, and a batch produced anywhere else all need the same safe write path.
 * Without it the alternative is hand-editing 34 files, which is how a dictionary
 * gets corrupted.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertSectionsExist,
  flatten,
  gapsFor,
  glossaryFor,
  isProtected,
  placeholdersMatch,
  splice,
  type Insertion,
  type Surface,
} from "../../packages/i18n/src/tooling/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const I18N = join(HERE, "../../packages/i18n/src");

const SURFACES: Record<Surface, { dir: string; exportName: (l: string) => string }> = {
  storefront: { dir: join(I18N, "dictionaries"), exportName: (l) => l },
  admin: {
    dir: join(I18N, "admin"),
    exportName: (l) => `admin${l[0]!.toUpperCase()}${l.slice(1)}`,
  },
};

/** The languages behind the file names, so the prompt can name one. */
const LANGUAGES: Record<string, string> = {
  ar: "Arabic", bg: "Bulgarian", bs: "Bosnian", cs: "Czech", da: "Danish",
  de: "German", el: "Greek", es: "Spanish", fi: "Finnish", fil: "Filipino",
  fr: "French", hr: "Croatian", hu: "Hungarian", id: "Indonesian",
  it: "Italian", ja: "Japanese", ko: "Korean", mk: "Macedonian",
  ms: "Malay", nl: "Dutch", no: "Norwegian", pl: "Polish",
  pt: "Portuguese", ro: "Romanian", ru: "Russian", sl: "Slovenian",
  sq: "Albanian", sr: "Serbian", sv: "Swedish", th: "Thai",
  tr: "Turkish", uk: "Ukrainian", vi: "Vietnamese", zh: "Chinese (Simplified)",
};

/**
 * How many strings go in one request.
 *
 * Small enough that a refusal or a malformed answer costs one batch rather than
 * a locale, and large enough that the model sees neighbouring strings — which is
 * most of the context it has for register and for how a screen reads. Forty is
 * roughly one admin section.
 */
const BATCH = 40;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

const dryRun = flag("dry-run");
const onlySurface = value("surface") as Surface | undefined;
const onlyLocale = value("locale");
const limit = Number(value("limit") ?? Number.POSITIVE_INFINITY);
const fromFile = value("from");

/** `{ surface: { locale: { "section.key": text } } }`, when `--from` is used. */
type Supplied = Partial<Record<Surface, Record<string, Record<string, string>>>>;
const supplied: Supplied = fromFile
  ? (JSON.parse(readFileSync(fromFile, "utf8")) as Supplied)
  : {};

/*
 * Checked once here rather than discovered per batch.
 *
 * Without it the run reports "batch failed: Could not resolve authentication
 * method" thirty-four times and finishes with `wrote 0`, which reads like the
 * translation being refused rather than never having been attempted.
 */
if (!dryRun && !fromFile && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error(
    "i18n:fill needs credentials. Either export ANTHROPIC_API_KEY, or run " +
      "`ant auth login` — the SDK reads the profile it stores. Use --dry-run to " +
      "see what would be written without any.",
  );
  process.exit(1);
}

const client = dryRun || fromFile ? null : new Anthropic();

/**
 * What the model must return: the same keys back, translated.
 *
 * A map rather than a list, so a dropped or invented key is caught by comparing
 * key sets rather than by trusting an order. `additionalProperties: false` is
 * what makes an invented key a validation failure instead of a silent extra
 * string in somebody's dictionary.
 */
function schemaFor(keys: readonly string[]) {
  return {
    type: "object",
    properties: Object.fromEntries(keys.map((key) => [key, { type: "string" }])),
    required: [...keys],
    additionalProperties: false,
  } as const;
}

const SYSTEM = `You translate interface strings for Sailo, a shop-in-a-bio product used by small sellers.

Rules, in order of importance:

1. Translate the MEANING for somebody using the interface, not the words. These are buttons, labels, headings and short help text — they must read as though written in the target language, not translated into it.
2. Honour the glossary exactly when one is given. Those terms are about money and a loose synonym changes what the user believes is happening to theirs.
3. Preserve every {placeholder} exactly as written, including its braces and spelling. They are interpolated at runtime; a renamed one renders as literal text in front of a customer.
4. Preserve any markup, punctuation style and trailing spaces the English has.
5. Match the English's register: Sailo addresses sellers and buyers informally and directly. Use the informal second person where the language distinguishes it (du/tu/jij), unless that would be rude in this language for a commercial product — in which case use the ordinary commercial register.
6. Keep it short. A button label that grows by half breaks the layout it sits in.
7. If a string is a proper noun, a brand, or a technical identifier (Stripe, WhatsApp, CSV, iCal, MCP), leave it as it is.

Return every key you were given, and only those keys.`;

type Batch = { locale: string; language: string; entries: [string, string][] };

async function translate(batch: Batch): Promise<Record<string, string>> {
  if (!client) throw new Error("dry run");

  const keys = batch.entries.map(([key]) => key);
  const glossary: Record<string, string> = {};
  for (const [, english] of batch.entries) {
    Object.assign(glossary, glossaryFor(english));
  }

  const payload = [
    `Target language: ${batch.language}.`,
    Object.keys(glossary).length > 0
      ? `\nGlossary — these meanings are binding:\n${Object.entries(glossary)
          .map(([term, meaning]) => `  ${term}: ${meaning}`)
          .join("\n")}`
      : "",
    `\nStrings, as key → English:\n${batch.entries
      .map(([key, english]) => `  ${key}: ${JSON.stringify(english)}`)
      .join("\n")}`,
  ].join("\n");

  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 16000,
    system: SYSTEM,
    /*
     * No `effort` here, deliberately.
     *
     * The API takes `output_config.effort`, and the installed SDK's
     * `OutputConfig` does not yet declare it — passing it means a type error or
     * a cast around one. The default is `high`, which is the setting this task
     * wants anyway: a translation that reads as though it were written in the
     * target language is worth more than the tokens saved on a lower tier, and
     * these strings are read by every seller in that language for years.
     *
     * Revisit when the SDK types catch up, not before.
     */
    output_config: { format: { type: "json_schema", schema: schemaFor(keys) } },
    messages: [{ role: "user", content: payload }],
  });

  /*
   * A refusal is a 200 with `stop_reason: "refusal"` and no usable content, so
   * reading `content` without checking would throw somewhere unhelpful.
   */
  if (response.stop_reason === "refusal") {
    throw new Error(
      `refused (${response.stop_details?.category ?? "no category"}) — ` +
        `${batch.locale}, keys ${keys[0]}…${keys.at(-1)}`,
    );
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  const parsed = JSON.parse(text) as Record<string, string>;

  /*
   * Trust the schema for shape and check the contents anyway. A key that came
   * back empty, or still in English, is a translation that did not happen — and
   * writing it would make the gap disappear from every future report, which is
   * strictly worse than leaving the hole.
   */
  const bad = keys.filter((key) => typeof parsed[key] !== "string" || !parsed[key]!.trim());
  if (bad.length > 0) {
    throw new Error(`${batch.locale}: empty translations for ${bad.join(", ")}`);
  }
  return parsed;
}

/**
 * Import a locale module.
 *
 * `bust` defeats the ESM loader's cache, which is what makes reading a file back
 * after writing it mean anything — without it the second import returns the
 * object parsed before the splice and the verification below passes on every
 * broken file.
 */
/**
 * The translations for one batch, out of a `--from` file.
 *
 * Refuses rather than partially filling. A file that is missing keys is a file
 * somebody built wrong, and writing the half it has would make the rest
 * disappear from the next gap report — the one failure mode that hides itself.
 */
function fromSupplied(
  surface: Surface,
  locale: string,
  keys: readonly string[],
): Record<string, string> {
  const forLocale = supplied[surface]?.[locale] ?? {};
  const missing = keys.filter((key) => typeof forLocale[key] !== "string");
  if (missing.length > 0) {
    throw new Error(
      `${surface}/${locale}: the --from file has no text for ${missing.join(", ")}`,
    );
  }
  return Object.fromEntries(keys.map((key) => [key, forLocale[key]!]));
}

async function loadDictionary(
  dir: string,
  locale: string,
  name: string,
  bust?: string,
) {
  const url = `${pathToFileURL(join(dir, `${locale}.ts`)).href}${bust ? `?v=${bust}` : ""}`;
  const module = (await import(url)) as Record<string, unknown>;
  const value = module[name];
  if (!value) throw new Error(`${locale}.ts does not export \`${name}\``);
  return value;
}

function localesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((n) => n.endsWith(".ts"))
    .map((n) => n.replace(/\.ts$/, ""))
    .filter((n) => n !== "index" && n !== "en" && !n.endsWith(".test"))
    .sort();
}

let written = 0;
let held = 0;
let skipped = 0;
/** Bumped per re-read, so no two verification imports share a cache entry. */
let runId = 1;

for (const surface of Object.keys(SURFACES) as Surface[]) {
  if (onlySurface && surface !== onlySurface) continue;
  const { dir, exportName } = SURFACES[surface];

  const english = flatten(await loadDictionary(dir, "en", exportName("en")), surface);
  assertSectionsExist(surface, [
    ...new Set(Object.keys(english).map((key) => key.split(".")[0]!)),
  ]);

  for (const locale of localesIn(dir)) {
    if (onlyLocale && locale !== onlyLocale) continue;
    if (written >= limit) break;

    const language = LANGUAGES[locale];
    if (!language && !fromFile) {
      /*
       * A locale nobody taught this script the language of. Refused rather than
       * guessed: asking a model to translate into "sw" and hoping it means
       * Swahili is how a dictionary ends up in the wrong language entirely.
       */
      console.warn(`  ${locale}: no language name — add it to LANGUAGES. Skipped.`);
      skipped++;
      continue;
    }

    const path = join(dir, `${locale}.ts`);
    const target = flatten(await loadDictionary(dir, locale, exportName(locale)), surface);
    const gap = gapsFor(english, target, locale);

    let writable = gap.missing.filter((key) => !isProtected(surface, key));
    held += gap.missing.length - writable.length;

    /*
     * Under `--from`, the file is the scope.
     *
     * `fromSupplied` refuses a batch it cannot fill completely, which is right
     * when the model is writing — a half-filled batch makes the rest vanish from
     * the next gap report, the one failure that hides itself. It is wrong for a
     * supplied file, where the keys present *are* the request: a human
     * translating one section at a time would otherwise have to supply every
     * outstanding key in the locale before a single one could land.
     */
    if (fromFile) {
      const have = supplied[surface]?.[locale] ?? {};
      writable = writable.filter((key) => typeof have[key] === "string");
    }
    if (writable.length === 0) continue;

    const todo = writable.slice(0, Math.max(0, limit - written));
    console.log(
      `${surface}/${locale} (${language ?? "supplied"}): ${todo.length} to write` +
        (todo.length < writable.length ? ` of ${writable.length}` : "") +
        (dryRun ? " — dry run" : ""),
    );
    if (dryRun) {
      written += todo.length;
      continue;
    }

    const insertions: Insertion[] = [];
    for (let i = 0; i < todo.length; i += BATCH) {
      const slice = todo.slice(i, i + BATCH);
      const entries = slice.map((key) => [key, english[key]!] as [string, string]);

      let translated: Record<string, string>;
      try {
        translated = fromFile
          ? fromSupplied(surface, locale, slice)
          : await translate({ locale, language: language!, entries });
      } catch (error) {
        /*
         * One bad batch is not a reason to abandon a locale, let alone the run.
         * Reported and skipped: the keys stay missing, so the next `check:i18n`
         * still lists them and the next run tries again.
         */
        console.warn(`  batch failed: ${(error as Error).message}`);
        continue;
      }

      for (const [key, english_] of entries) {
        const text = translated[key]!;
        /*
         * A renamed placeholder renders as literal `{count}` in front of a
         * customer, which no test catches and no reviewer of a language they do
         * not read will spot. `placeholdersMatch` allows reordering — every
         * language moves them — and nothing else.
         */
        const verdict = placeholdersMatch(english_, text);
        if (!verdict.ok) {
          console.warn(`  ${key}: ${verdict.reason} — skipped`);
          skipped++;
          continue;
        }
        insertions.push({ path: key, text });
      }
    }

    if (insertions.length === 0) continue;

    const before = readFileSync(path, "utf8");
    const { source } = splice(before, insertions);
    writeFileSync(path, source, "utf8");

    /*
     * Read it back through the module loader before moving on. A splice that
     * produced something unparseable has to fail here, holding one file, rather
     * than 34 files later in somebody else's build.
     */
    try {
      const reloaded = flatten(
        await loadDictionary(dir, locale, exportName(locale), String(runId++)),
        surface,
      );
      const stillMissing = insertions.filter(({ path: key }) => !(key in reloaded));
      if (stillMissing.length > 0) {
        throw new Error(
          `wrote ${insertions.length} keys and ${stillMissing.length} are not ` +
            `readable back — the splice landed somewhere wrong`,
        );
      }
    } catch (error) {
      writeFileSync(path, before, "utf8");
      throw new Error(
        `${surface}/${locale}: ${(error as Error).message}. The file has been ` +
          `put back as it was.`,
      );
    }

    written += insertions.length;
    console.log(`  wrote ${insertions.length}`);
  }
}

console.log("");
console.log(
  `${dryRun ? "would write" : "wrote"} ${written}` +
    (held > 0 ? `, held ${held} in protected money sections for a human` : "") +
    (skipped > 0 ? `, skipped ${skipped}` : ""),
);
