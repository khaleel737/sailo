import { useEffect, useSyncExternalStore } from "react";
import { I18nManager } from "react-native";
import * as SecureStore from "expo-secure-store";
import {
  DEFAULT_LOCALE,
  EN_BUNDLE,
  LOCALES,
  isLocale,
  loadBundle,
  loadedBundle,
  pickLocale,
  type AdminDictionary,
  type Bundle,
  type Dictionary,
  type Direction,
  type Locale,
} from "@sailo/i18n/native";

/**
 * The seller's language, on this phone.
 *
 * The framework half of i18n. `@sailo/i18n/native` holds the dictionaries and
 * the negotiation and has no dependencies at all — deliberately, because
 * `@sailo/core` imports that package for a type and `apps/api` imports core, so
 * a React Native peer over there would put a React Native requirement on a
 * headless JSON server. Everything that needs React, React Native or Expo is
 * here instead, in the app that already declares all three.
 *
 * A module-level store rather than a context, and deliberately. A provider
 * would have to be mounted in `app/_layout.tsx` before a single screen could
 * read a string, which makes every screen wait on one file; it would also put
 * the locale out of reach of everything that is not a component — a
 * notification handler formatting a title, an error reporter choosing a
 * message. Locale is a genuine process singleton, so this models it as one and
 * `useT()` subscribes through `useSyncExternalStore`.
 *
 * Persisted in `expo-secure-store`, not because a language is a secret but
 * because it is the storage this app already has: already a dependency, already
 * a config plugin in `app.json`, already where `lib/auth.ts` keeps the session.
 * Adding `@react-native-async-storage/async-storage` to hold one two-letter
 * string would be a second storage engine for no gain.
 */

const STORAGE_KEY = "sailo.locale";

/*
 * ---------------------------------------------------------------------------
 * Reading the handset
 * ---------------------------------------------------------------------------
 */

/**
 * What language the phone is set to.
 *
 * **Temporary, and the gap is real.** Both sources below return *one* locale.
 * `expo-localization`'s `getLocales()` returns every language the device is
 * configured for, in the seller's own order — which matters for the seller
 * whose first language Sailo does not ship: with the list we fall to their
 * *second* choice, and with one locale we fall to English. That is the
 * behaviour we are accepting until then, not a design.
 *
 * It is not installed yet on purpose. `expo-localization` is a native module,
 * so adding it means a dependency in this app, a regenerated `pnpm-lock.yaml`
 * in a tree several agents are working in, and a dev-client rebuild for all of
 * them. **A01 is already adding Unistyles, Reanimated, FlashList and SVG and
 * already forces one rebuild**, so it rides along there and everyone rebuilds
 * once. When it lands, this function becomes
 * `Localization.getLocales().map((l) => l.languageTag)` and nothing else in the
 * app changes — which is the whole reason the two sources are behind one
 * function.
 *
 * Two sources because neither platform has both. `I18nManager`'s
 * `localeIdentifier` constant is populated on Android only — the iOS module
 * (`RCTI18nManager.mm`) exports `isRTL` and `doLeftAndRightSwapInRTL` and
 * nothing else. `Intl` covers iOS, and both.
 */
export function deviceLocales(): readonly string[] {
  const tags: string[] = [];

  // Android hands back a Java `Locale.toString()` — `ar_SA`, underscore and
  // all. `pickLocale` normalises it; it is passed through as it arrives.
  const native = I18nManager.getConstants().localeIdentifier;
  if (native) tags.push(native);

  /*
   * Wrapped because this is the one call here that can throw. A Hermes build
   * without Intl would take locale resolution down with it, and the honest
   * outcome of "I cannot tell what language this phone is in" is English, not
   * a crash on the first frame.
   */
  try {
    const resolved = new Intl.DateTimeFormat().resolvedOptions().locale;
    if (resolved) tags.push(resolved);
  } catch {
    // No Intl. Whatever Android gave us, or English.
  }

  return tags;
}

/*
 * ---------------------------------------------------------------------------
 * Layout direction
 * ---------------------------------------------------------------------------
 */

/** Whether the app is laid out right-to-left right now. */
export function isRTL(): boolean {
  return I18nManager.isRTL;
}

/**
 * Points the *next* launch at a direction. Returns whether that is a change —
 * which is to say, whether a reload is needed for it to show.
 *
 * React Native decides direction once, natively, before any JavaScript runs,
 * and every mounted view reads it at layout time. `forceRTL` writes the answer
 * for next launch (Android: SharedPreferences; iOS: the `RCTI18nUtil_forceRTL`
 * user default) and leaves the running app exactly as it was. That is why a
 * direction change needs a reload and a language change does not.
 *
 * Sailo does not get the automatic behaviour. React Native flips on its own
 * only when the *app* declares the language — an iOS bundle with `ar` in
 * `CFBundleLocalizations`, an Android app with Arabic resources — and Sailo's
 * translations live in TypeScript, not in native resource files. As far as the
 * OS is concerned this app speaks English, so it has to be forced.
 *
 * Both calls, not just `forceRTL`. Turning RTL off has to clear `allowRTL` too:
 * iOS resolves `isRTL` as `forced || (allowed && the app's own language is
 * RTL)`, so on a handset set to Arabic, `forceRTL(false)` alone leaves the
 * second clause true and the app mirrored in a language that reads
 * left-to-right.
 *
 * Idempotent by design — called on every cold start with the persisted locale,
 * and on all but the first it finds the direction already correct and reports
 * no reload needed. Without that check the app would ask to restart itself
 * every single launch in Arabic.
 */
function applyDirection(dir: Direction): boolean {
  const wanted = dir === "rtl";
  if (I18nManager.isRTL === wanted) return false;

  I18nManager.allowRTL(wanted);
  I18nManager.forceRTL(wanted);
  return true;
}

/*
 * ---------------------------------------------------------------------------
 * The store
 * ---------------------------------------------------------------------------
 */

/** What every subscriber sees. Replaced wholesale; never mutated in place. */
export type LocaleState = {
  /**
   * What the seller chose, and what is on disk. Leads `bundle.locale` while a
   * dictionary is loading, and stays ahead of it if that load failed — their
   * choice is not thrown away because one import did not resolve.
   */
  selected: Locale;
  /** The strings actually rendering. `locale`, `t`, `a` and `dir` always agree. */
  bundle: Bundle;
  /** Whether startup has finished reading storage and the handset's language. */
  ready: boolean;
  /** Whether a locale change is in flight. */
  pending: boolean;
  /**
   * Whether the direction on disk no longer matches the running process. See
   * `applyDirection`: the only way to show it is to start again.
   */
  reloadRequired: boolean;
};

let state: LocaleState = {
  selected: DEFAULT_LOCALE,
  bundle: EN_BUNDLE,
  ready: false,
  pending: false,
  reloadRequired: false,
};

const listeners = new Set<() => void>();

function publish(next: LocaleState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * `useSyncExternalStore` compares snapshots by identity and re-renders on every
 * difference, so this has to hand back the same object until something actually
 * changes. That is the whole reason `publish` replaces `state` rather than
 * editing it.
 */
function getSnapshot(): LocaleState {
  return state;
}

/**
 * Reads and writes are both wrapped. The keychain can refuse — a locked device
 * during a background launch, a simulator without the entitlement — and the
 * cost of that is a seller seeing English until they set the language again,
 * which is not worth taking the app down for.
 */
async function readStored(): Promise<Locale | null> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

async function writeStored(locale: Locale): Promise<void> {
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, locale);
  } catch {
    // Unpersisted, but applied for this session.
  }
}

/**
 * Which locale change is the current one.
 *
 * Two can overlap — startup reading the keychain while a seller taps a
 * language, or a seller tapping twice — and dictionaries do not necessarily
 * resolve in the order they were asked for. Without this the slower of two
 * loads wins and the app settles on a language nobody chose last. Every entry
 * point takes a token and every write checks it still holds.
 */
let generation = 0;

/**
 * Swaps in a locale that has finished loading, and points the next launch at
 * its direction.
 *
 * Direction is applied *after* the load rather than beside it, so a dictionary
 * that failed to import cannot leave the app mirrored for strings that are
 * still in English. `reloadRequired` is sticky: once a flip is pending, a
 * further change that happens to land back on the original direction does not
 * clear it, because the process is still running the direction it booted with.
 */
function adopt(bundle: Bundle, selected: Locale, token: number) {
  if (token !== generation) return;

  const flipped = applyDirection(bundle.dir);
  publish({
    selected,
    bundle,
    ready: true,
    pending: false,
    reloadRequired: state.reloadRequired || flipped,
  });
}

let started: Promise<void> | null = null;

/**
 * Resolves the language once per launch: the seller's stored choice if they
 * have made one, otherwise whatever the handset is set to, otherwise English.
 *
 * Idempotent and safe to call from anywhere — the first caller does the work
 * and everyone else awaits it. `useT()` calls it on mount, so no screen has to
 * remember to; `app/_layout.tsx` may still call it early to start the keychain
 * read before the first render rather than during it.
 */
export function initLocale(): Promise<void> {
  started ??= (async () => {
    const token = ++generation;
    const stored = await readStored();
    const selected = stored ?? pickLocale(deviceLocales());

    /*
     * English is already built and already in `state`, so it skips the load
     * entirely and only settles `ready` — the common case costs one keychain
     * read and no dictionary work at all.
     */
    if (selected === DEFAULT_LOCALE) {
      adopt(EN_BUNDLE, DEFAULT_LOCALE, token);
      return;
    }

    if (token === generation) publish({ ...state, selected, pending: true });
    adopt(await loadBundle(selected), selected, token);
  })();

  return started;
}

/**
 * Changes the language, from Settings.
 *
 * Persists first, so a seller who force-quits mid-load still gets what they
 * asked for next launch — and unconditionally, even when the app is already
 * showing that language. It very often *is*: a seller on an Arabic handset is
 * reading Arabic that was inferred, not chosen, and tapping Arabic is how they
 * pin it. Skipping the write there would leave their choice implicit, and Sailo
 * would quietly follow the phone the next time they changed it.
 *
 * Resolves once the new strings are on screen; the caller can await it to keep
 * a control disabled until then.
 *
 * Whether this needs a reload to look right is on the state it publishes, not
 * in the return value — the answer depends on the direction of *both* locales,
 * so the Settings screen reads `reloadRequired` and says so rather than
 * guessing from the code it passed in.
 */
export async function setLocale(next: Locale): Promise<void> {
  /*
   * Claims the generation before anything awaits, so an `initLocale` still
   * reading the keychain cannot land on top of an explicit choice made while it
   * was in flight. Marking startup as begun stops a later `initLocale` from
   * re-resolving over it too.
   */
  const token = ++generation;
  started ??= Promise.resolve();

  await writeStored(next);

  const already = loadedBundle(next);
  if (already) {
    adopt(already, next, token);
    return;
  }

  if (token === generation) publish({ ...state, selected: next, pending: true });
  adopt(await loadBundle(next), next, token);
}

/*
 * ---------------------------------------------------------------------------
 * Hooks
 * ---------------------------------------------------------------------------
 */

/**
 * How a screen reads a string.
 *
 * Shaped to match `getAdminT()` in `apps/web/src/i18n/server.ts` exactly —
 * `locale`, `t`, `a`, `dir` — so the same key reads the same way on both sides
 * of the codebase and moving a screen between them is a mechanical job:
 *
 *     const { a } = useT();
 *     <Text variant="title">{a.orders.title}</Text>
 *
 * `a` is the admin dictionary and `t` the storefront one, the same split and the
 * same letters the web uses, so a component holding both never has to think
 * about which it is reading.
 *
 * **It never returns undefined and never suspends.** English is compiled into
 * the bundle, so the first frame renders in English and re-renders in the
 * seller's language the moment their dictionary resolves — a few milliseconds,
 * and never a spinner where a word should be. A screen that would rather wait
 * can read `ready` from `useLocaleSettings()`.
 */
export function useT(): {
  locale: Locale;
  t: Dictionary;
  a: AdminDictionary;
  dir: Direction;
} {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  /*
   * Startup is kicked off from an effect rather than during render because it
   * writes to the store, and a store written to while React is rendering is how
   * `useSyncExternalStore` ends up tearing. It is idempotent, so every mounted
   * screen calling it costs one `??=`.
   */
  useEffect(() => {
    void initLocale();
  }, []);

  return snapshot.bundle;
}

/**
 * Everything the Settings screen needs to offer the seller a language, and
 * nothing any other screen does.
 *
 * `options` is the `LOCALES` table unchanged — code, English name, native name,
 * direction and flag — so the picker can list "العربية" rather than "Arabic"
 * without a second table to keep in step.
 *
 * **`reloadRequired` is not optional to handle.** Switching between two
 * left-to-right languages takes effect immediately. Switching *into or out of*
 * Arabic cannot: React Native fixes the layout direction natively before any
 * JavaScript runs, so the strings change on the spot and the mirroring does not
 * until the app starts again. When this flag is true the screen must say so —
 * offer a restart (`Updates.reloadAsync()` from `expo-updates`, which this app
 * already depends on) or tell the seller the layout will finish changing next
 * time they open Sailo. What it must not do is nothing, because a half-mirrored
 * screen reads as a broken app rather than as a pending restart.
 */
export function useLocaleSettings(): {
  /** The seller's choice, which leads the strings while one is loading. */
  selected: Locale;
  options: typeof LOCALES;
  setLocale: (next: Locale) => Promise<void>;
  /** Startup has finished reading storage and the handset's language. */
  ready: boolean;
  /** A language change is loading its dictionary. */
  pending: boolean;
  reloadRequired: boolean;
} {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    void initLocale();
  }, []);

  return {
    selected: snapshot.selected,
    options: LOCALES,
    setLocale,
    ready: snapshot.ready,
    pending: snapshot.pending,
    reloadRequired: snapshot.reloadRequired,
  };
}
