import { en, type Dictionary } from "../dictionaries/en";
import type { AdminDictionary, PartialAdminDictionary } from "../admin/en";
import { mergeAdmin } from "../admin-merge";
import { DEFAULT_LOCALE, directionOf, type Direction, type Locale } from "../config";

/**
 * The dictionaries, one locale at a time.
 *
 * This is the whole reason `@sailo/i18n/native` exists. The root export loads
 * all thirty-five storefront dictionaries at module scope and
 * `@sailo/i18n/admin` loads all thirty-five admin ones, which is right for a
 * server that has to answer any locale on any request and wrong for a phone
 * that will hold exactly one for the life of the install. Reading admin strings
 * through the root exports would have every cold start build seventy dictionary
 * objects to use two of them.
 *
 * So English is a static import — it is the fallback, the app must be able to
 * render before any promise resolves, and it is the locale most sellers use —
 * and the other thirty-four sit behind `import()`.
 *
 * **The paths are string literals, and they have to stay that way.** Metro
 * resolves `import()` statically at bundle time: a computed specifier
 * (`import(\`../admin/${code}\`)`) either fails to resolve or silently pulls
 * every sibling file in, which is the opposite of the point. That is also why
 * this is thirty-four typed-out lines rather than a loop — the ugliness is
 * load-bearing.
 *
 * **What `import()` buys on native, precisely.** Checked against Metro rather
 * than assumed: each loader below compiles to `require(asyncRequire)(…)` *inside*
 * the function body, so the module factory runs only when a seller picks that
 * language. The bundle is still one file — Metro emits no async chunks for
 * native — so the other thirty-four locales remain *bytes* in the app; what
 * defers is their evaluation. That is the cold-start cost this removes, and it
 * is worth being exact about which of the two it is. If Expo ships native chunk
 * splitting, this code splits without a change. The README has the numbers.
 */

/** Everything a screen needs to render, in one locale. */
export type Bundle = {
  locale: Locale;
  /** The storefront dictionary — `t` on the web, and `t` here. */
  t: Dictionary;
  /** The admin dictionary, merged over English — `a` on the web, and `a` here. */
  a: AdminDictionary;
  dir: Direction;
};

type Loaders<T> = Record<Exclude<Locale, "en">, () => Promise<T>>;

const ADMIN: Loaders<PartialAdminDictionary> = {
  ar: () => import("../admin/ar").then((m) => m.adminAr),
  bg: () => import("../admin/bg").then((m) => m.adminBg),
  bs: () => import("../admin/bs").then((m) => m.adminBs),
  cs: () => import("../admin/cs").then((m) => m.adminCs),
  da: () => import("../admin/da").then((m) => m.adminDa),
  de: () => import("../admin/de").then((m) => m.adminDe),
  el: () => import("../admin/el").then((m) => m.adminEl),
  es: () => import("../admin/es").then((m) => m.adminEs),
  fi: () => import("../admin/fi").then((m) => m.adminFi),
  fil: () => import("../admin/fil").then((m) => m.adminFil),
  fr: () => import("../admin/fr").then((m) => m.adminFr),
  hr: () => import("../admin/hr").then((m) => m.adminHr),
  hu: () => import("../admin/hu").then((m) => m.adminHu),
  id: () => import("../admin/id").then((m) => m.adminId),
  it: () => import("../admin/it").then((m) => m.adminIt),
  ja: () => import("../admin/ja").then((m) => m.adminJa),
  ko: () => import("../admin/ko").then((m) => m.adminKo),
  mk: () => import("../admin/mk").then((m) => m.adminMk),
  ms: () => import("../admin/ms").then((m) => m.adminMs),
  nl: () => import("../admin/nl").then((m) => m.adminNl),
  no: () => import("../admin/no").then((m) => m.adminNo),
  pl: () => import("../admin/pl").then((m) => m.adminPl),
  pt: () => import("../admin/pt").then((m) => m.adminPt),
  ro: () => import("../admin/ro").then((m) => m.adminRo),
  ru: () => import("../admin/ru").then((m) => m.adminRu),
  sl: () => import("../admin/sl").then((m) => m.adminSl),
  sq: () => import("../admin/sq").then((m) => m.adminSq),
  sr: () => import("../admin/sr").then((m) => m.adminSr),
  sv: () => import("../admin/sv").then((m) => m.adminSv),
  th: () => import("../admin/th").then((m) => m.adminTh),
  tr: () => import("../admin/tr").then((m) => m.adminTr),
  uk: () => import("../admin/uk").then((m) => m.adminUk),
  vi: () => import("../admin/vi").then((m) => m.adminVi),
  zh: () => import("../admin/zh").then((m) => m.adminZh),
};

const STOREFRONT: Loaders<Dictionary> = {
  ar: () => import("../dictionaries/ar").then((m) => m.ar),
  bg: () => import("../dictionaries/bg").then((m) => m.bg),
  bs: () => import("../dictionaries/bs").then((m) => m.bs),
  cs: () => import("../dictionaries/cs").then((m) => m.cs),
  da: () => import("../dictionaries/da").then((m) => m.da),
  de: () => import("../dictionaries/de").then((m) => m.de),
  el: () => import("../dictionaries/el").then((m) => m.el),
  es: () => import("../dictionaries/es").then((m) => m.es),
  fi: () => import("../dictionaries/fi").then((m) => m.fi),
  fil: () => import("../dictionaries/fil").then((m) => m.fil),
  fr: () => import("../dictionaries/fr").then((m) => m.fr),
  hr: () => import("../dictionaries/hr").then((m) => m.hr),
  hu: () => import("../dictionaries/hu").then((m) => m.hu),
  id: () => import("../dictionaries/id").then((m) => m.id),
  it: () => import("../dictionaries/it").then((m) => m.it),
  ja: () => import("../dictionaries/ja").then((m) => m.ja),
  ko: () => import("../dictionaries/ko").then((m) => m.ko),
  mk: () => import("../dictionaries/mk").then((m) => m.mk),
  ms: () => import("../dictionaries/ms").then((m) => m.ms),
  nl: () => import("../dictionaries/nl").then((m) => m.nl),
  no: () => import("../dictionaries/no").then((m) => m.no),
  pl: () => import("../dictionaries/pl").then((m) => m.pl),
  pt: () => import("../dictionaries/pt").then((m) => m.pt),
  ro: () => import("../dictionaries/ro").then((m) => m.ro),
  ru: () => import("../dictionaries/ru").then((m) => m.ru),
  sl: () => import("../dictionaries/sl").then((m) => m.sl),
  sq: () => import("../dictionaries/sq").then((m) => m.sq),
  sr: () => import("../dictionaries/sr").then((m) => m.sr),
  sv: () => import("../dictionaries/sv").then((m) => m.sv),
  th: () => import("../dictionaries/th").then((m) => m.th),
  tr: () => import("../dictionaries/tr").then((m) => m.tr),
  uk: () => import("../dictionaries/uk").then((m) => m.uk),
  vi: () => import("../dictionaries/vi").then((m) => m.vi),
  zh: () => import("../dictionaries/zh").then((m) => m.zh),
};

/**
 * English, built once at module scope. `mergeAdmin({})` rather than `adminEn`
 * so the object handed to a screen is the same shape whichever locale is
 * active — a screen that reads `a.orders.title` must not care that English
 * skipped a merge.
 */
export const EN_BUNDLE: Bundle = {
  locale: DEFAULT_LOCALE,
  t: en,
  a: mergeAdmin({}),
  dir: directionOf(DEFAULT_LOCALE),
};

/** Built bundles, kept for the life of the process. */
const built = new Map<Locale, Bundle>([[DEFAULT_LOCALE, EN_BUNDLE]]);

/**
 * In-flight loads, so two screens mounting at once share one import rather
 * than racing to build the same dictionary twice.
 */
const inFlight = new Map<Locale, Promise<Bundle>>();

/** A locale already resolved, or undefined if it still has to be fetched. */
export function loadedBundle(locale: Locale): Bundle | undefined {
  return built.get(locale);
}

/**
 * Resolves a locale, loading its two dictionaries if this is the first ask.
 *
 * A failed `import()` falls back to English rather than throwing. The failure
 * mode it guards is a real one — a partially written update, a corrupt bundle —
 * and a seller reading English is recoverable in a way that a screen which
 * refuses to render is not. It is not cached as a success, so the next attempt
 * tries again.
 */
export async function loadBundle(locale: Locale): Promise<Bundle> {
  const hit = built.get(locale);
  if (hit) return hit;

  const pending = inFlight.get(locale);
  if (pending) return pending;

  const key = locale as Exclude<Locale, "en">;
  const task = Promise.all([ADMIN[key](), STOREFRONT[key]()])
    .then(([a, t]) => {
      const bundle: Bundle = {
        locale,
        t,
        a: mergeAdmin(a),
        dir: directionOf(locale),
      };
      built.set(locale, bundle);
      return bundle;
    })
    .catch(() => EN_BUNDLE)
    .finally(() => {
      inFlight.delete(locale);
    });

  inFlight.set(locale, task);
  return task;
}
