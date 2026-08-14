# @sailo/i18n

Thirty-five locales, three audiences, two runtimes.

| Entry | Who reads it | Loading |
|---|---|---|
| `@sailo/i18n` | Storefront — what a buyer sees | All 35, eagerly |
| `@sailo/i18n/admin` | Admin — what a seller sees | All 35, eagerly |
| `@sailo/i18n/marketing` | The landing pages | All 35, eagerly |
| `@sailo/i18n/config` | Locale codes, names, direction, matching | No dictionaries |
| **`@sailo/i18n/native`** | **The mobile app** | **English static, 34 on demand** |

The eager loading is correct for a Node server: it renders any locale on any
request, the dictionaries are plain objects, and a promise on the render path
would buy nothing. It is wrong for a React Native bundle, which holds one locale
for the life of an install. Hence the fifth entry — and the server's behaviour
is untouched by it.

## This package has no dependencies, and that is load-bearing

Not react, not react-native, not expo — not even as optional peers. `@sailo/core`
imports this package for the `Dictionary` type, `packages/api` imports core, and
`apps/api` is a headless JSON server. A `react-native` peer here would give that
server a React Native requirement for a type it uses to describe strings.

So `@sailo/i18n/native` is split by purity. It holds **loading a locale and
choosing one**, and nothing else:

- the dynamic-import map, `locale → () => import("../dictionaries/xx")`
- `pickLocale(tags)` — given candidate tags, the best locale Sailo ships
- which locales are RTL, which is data (`config.ts`) rather than behaviour

The framework half lives in **`apps/mobile/lib/i18n.tsx`**, where React, React
Native and Expo are already dependencies: the `useT()` hook, `I18nManager`
setup, reading the handset's language, and persisting the seller's override.

**Screens import `useT` from `../lib/i18n`, not from this package.** If a hook
ever genuinely has to be shared, its home is `@sailo/design-native` — which
already depends on react and react-native — never here.

---

## Mobile: reading a string

```tsx
import { useT } from "../../lib/i18n";

export default function Orders() {
  const { a, t, locale, dir } = useT();
  return <Text variant="title">{a.orders.title}</Text>;
}
```

`{ locale, t, a, dir }` — the same four the web's `getAdminT()` returns, so the
same key reads the same way on both sides of the codebase.

- **`a`** is the admin dictionary: the seller's app is nearly all of this.
- **`t`** is the storefront dictionary — the strings both surfaces share, sign-in
  and onboarding among them.
- **`dir`** is `"ltr"` or `"rtl"`. You should rarely need it; see below.

No provider to mount, no `await`, no `undefined`. English is compiled into the
bundle, so the first frame renders and the seller's language arrives underneath
it. A screen that would rather wait can read `ready` from `useLocaleSettings()`.

Counted and interpolated strings use the same two helpers the web calls:

```ts
import { interpolate, plural } from "@sailo/i18n/native"; // pure, import direct

plural(count, a.orders.awaitingOne, a.orders.awaiting);
interpolate(a.integrations.keyLimit, { count, max });
```

The dictionary's convention is `<key>One` for the singular beside `<key>` for
the counted form, and `plural` takes them in that order.

**There is no `t("some.key")` string-path lookup, deliberately.** `a.orders.title`
is a property read that TypeScript checks: a key that does not exist is a build
error, and `en.ts` being the typed source means a missing translation is one too.
A string path would give up both.

## Mobile: the language picker

```tsx
import { useLocaleSettings } from "../../lib/i18n";

const { selected, options, setLocale, pending, reloadRequired } = useLocaleSettings();
```

`options` is the `LOCALES` table — code, English name, native name, direction,
flag — so the list can say "العربية" rather than "Arabic" without a second table
to keep in step.

**`reloadRequired` is not optional to handle.** See "What a locale change costs".

---

## Layout is logical, never physical

Arabic ships. This is the rule every screen and every component follows, and it
is one line:

> **`start` and `end`. Never `left` and `right`.**

```ts
// Wrong — reads correctly in English and backwards in Arabic.
{ marginLeft: 12, paddingRight: 16, borderLeftWidth: 1, textAlign: "left" }

// Right.
{ marginStart: 12, paddingEnd: 16, borderStartWidth: 1, textAlign: "auto" }
```

React Native has the logical form of every box property: `marginStart` /
`marginEnd`, `paddingStart` / `paddingEnd`, `borderStartWidth` /
`borderEndWidth`, `borderStartStartRadius` and its three siblings, and `start` /
`end` in place of `left` / `right` on an absolutely positioned view.
`flexDirection: "row"` mirrors itself — that one needs no thought.

Two asymmetries that catch people out:

- **`textAlign` has no `start`.** React Native's union is `auto | left | right |
  center | justify`. `auto` follows the text's own direction and is the answer
  for body copy. Deliberately aligning to the far edge means branching on
  `isRTL()` — there is no logical keyword for it.
- **React Native already swaps `left` and `right` under RTL**
  (`doLeftAndRightSwapInRTL`, on by default). That is the trap, not a reason to
  relax the rule: it leaves the code saying "left" while meaning "start", so
  nothing on screen tells you which of the two a line intended — and the one
  place that genuinely needs physical left has no way left to say it.

**Numbers are not text and do not mirror.** An amount of money goes through
`<Money>` from `@sailo/design-native`, which routes to `formatMoney` in
`@sailo/core/currency`. That already knows where a locale puts its currency
symbol and pins the digits to 0-9, so Arabic does not render numerals no seller
asked for. Pass it the `locale` from `useT()`. Never concatenate a symbol onto a
number.

---

## What a locale change costs

**Strings swap immediately. There is no restart for a language.**

**Direction cannot.** React Native settles the layout direction natively, once,
before any JavaScript runs; `I18nManager.forceRTL` writes the answer for the
*next* launch and leaves the running app exactly as it was. So:

| Change | Effect |
|---|---|
| English → French, French → Japanese, … | Instant. `reloadRequired` stays false. |
| Anything → Arabic, Arabic → anything | Strings instant, mirroring pending. `reloadRequired` becomes true. |

When `reloadRequired` is true the Settings screen must say so — offer a restart
(`Updates.reloadAsync()` from `expo-updates`, already a dependency) or tell the
seller the layout finishes changing next time they open Sailo. What it must not
do is nothing: a half-mirrored screen reads as a broken app rather than as a
pending restart.

It is once per switch, not once per launch. `forceRTL` persists natively —
Android in SharedPreferences, iOS in the `RCTI18nUtil_forceRTL` user default —
so the launch after the reload already comes up mirrored.

Sailo does not get this for free, incidentally. React Native flips on its own
only when the *app* declares the language: an iOS bundle with `ar` in
`CFBundleLocalizations`, an Android app with Arabic resources. Sailo's
translations live in TypeScript, so as far as the OS is concerned this app speaks
English and the flip has to be forced.

---

## Where the locale comes from

In order: the seller's stored choice, then the handset's language, then English.

The choice is persisted in **`expo-secure-store`** — not because a language is a
secret, but because it is the storage this app already has: already a
dependency, already a config plugin in `app.json`, already where `lib/auth.ts`
keeps the session. Adding `@react-native-async-storage/async-storage` to hold
one two-letter string would be a second storage engine for no gain.

The handset's language is read in `apps/mobile/lib/i18n.tsx` by `deviceLocales()`,
from `I18nManager`'s `localeIdentifier` constant (Android only — the iOS module
does not export it) and from `Intl.DateTimeFormat().resolvedOptions().locale`.
The choice between candidates is `pickLocale()` here, which is pure.

**`deviceLocales()` is temporary, and the gap it leaves is real.** Both sources
return **one** locale, not the seller's ordered preference list. So a seller
whose *first* language Sailo does not ship falls to English rather than to their
second choice. `expo-localization`'s `getLocales()` returns the whole ordered
list and closes it.

It is not installed yet on purpose: it is a native module, so it means a
lockfile regenerated in a tree several agents are working in and a dev-client
rebuild for all of them. **A01 is already adding Unistyles, Reanimated,
FlashList and SVG and already forces one rebuild**, so it rides along there and
everyone rebuilds once. When it lands, `deviceLocales()` becomes
`Localization.getLocales().map((l) => l.languageTag)` and nothing else changes —
which is why the two sources sit behind one function.

---

## What Hermes actually does with `Intl`

Probed against the Hermes VM that ships with React Native 0.81
(`node_modules/react-native/sdks/hermesc/osx-bin/hermes`). **This is the host
build, not an iOS or Android device build** — treat it as strong evidence, not
proof. Each row needs confirming on hardware.

| | Hermes | Node (reference) |
|---|---|---|
| `new Intl.DateTimeFormat().resolvedOptions().locale` | `en-US` | `en-US` |
| `Intl.NumberFormat("de-DE", …EUR)` | `1.234,50 €` | same |
| `Intl.NumberFormat("ar-SA-u-nu-latn", …SAR)` | `١٬٢٣٤٫٥٠ ر.س.` | `1,234.50 ر.س.` |
| `…resolvedOptions().numberingSystem` | `undefined` | `latn` |
| `Intl.DisplayNames` | `undefined` | `function` |

Two consequences, neither of them this package's to fix:

- **`formatMoney` in `@sailo/core/currency` appends `-u-nu-latn` to pin digits to
  0-9, and Hermes ignores it.** Its own comment says those numerals are "a change
  no seller asked for and every one of their buyers would notice" — on the phone
  they get them anyway. It does not throw, so the `catch` never fires and nothing
  reports it. Owner: whoever holds `@sailo/core`.
- **`currencyLabel` degrades to a bare code on mobile.** `Intl.DisplayNames` does
  not exist in Hermes; the function already catches and returns `"USD"` rather
  than `"USD — US Dollar"`, so a currency picker on the phone shows codes only.



## Admin keys that assume a browser

Audited 2026-08-14. Four keys in `admin/en.ts` describe an interaction the phone
does not have. They are **not** rewritten here — the copy is a product decision,
and every one of them is already translated into thirty-four languages. Screen
agents should not reuse them on mobile as they stand:

| Key | Reads | Why it does not fit |
|---|---|---|
| `checkin.scanBlockedBody` | "Allow camera access **in your browser**…" | A05's own scanner asks the OS, not a browser. The most likely to be read on a phone. |
| `shell.verifyEmailBody` | "…one **click** proves this address is yours." | A tap. Minor, but it is the only interaction verb in the dictionary that names a mouse. |
| `settings.matchBrowser` | "Match the visitor's **browser**" | Correct as written — it is about the *buyer's* browser on the storefront, not the seller's device. Listed so nobody "fixes" it. |
| `integrations.alsoBody` | "…live on the Details **tab**." | "Tab" is the admin's own tab strip, which the mobile IA does not reproduce. |

Nothing else in 1,071 keys assumes a mouse, a window, a right-click, a hover, a
keyboard shortcut or a URL bar.

---

## Cold-start cost, measured

Built with esbuild at `packages/i18n/src`, minified, code-split, native modules
externalised:

| | Evaluated before the first frame | All locales present |
|---|---|---|
| A screen via `@sailo/i18n` + `/admin` | **3,395 KB** (70 dictionaries) | 3,395 KB |
| A screen via `@sailo/i18n/native` | **67 KB** (2 dictionaries) | 3,399 KB |

**51× less work before the first frame**, which is the acceptance criterion: the
cold start builds one language, not thirty-five.

Be precise about which cost that is, because Metro was asked rather than assumed.
`apps/mobile/lib/i18n.tsx` was bundled through this app's own `metro.config.js`
(`platform: "ios"`, `dev: false`) and the output inspected:

- **`@sailo/i18n/native` resolves.** Metro's `unstable_enablePackageExports`
  defaults to true, so the subpath export works.
- **All sixty-eight `import()`s resolve.** The build succeeds and the Arabic
  strings are in the output — one bundle, no async chunks. Metro does not emit
  them for native, so the other thirty-four locales are still *bytes* in the app.
- **Their evaluation is genuinely deferred.** Each loader compiles to
  `function ar() { return require(asyncRequire)(<module>, …).then((m) => m.adminAr) }`
  — the require is *inside* the function body, so the module factory runs only
  when a seller picks that language. Not an inline-requires side effect either;
  Expo sets `inlineRequires: false`, so this holds regardless.

If Expo ships native chunk splitting, this code splits with no change.

## Adding a locale

1. `packages/i18n/src/config.ts` — add to `LOCALES` with its `dir`.
2. `dictionaries/<code>.ts`, `admin/<code>.ts`, `marketing/<code>.ts`.
3. Register in each `index.ts`, and in **both** loader maps in
   `src/native/bundles.ts`.

Step 3's native half is not optional and the compiler enforces it: the loader
maps are `Record<Exclude<Locale, "en">, …>`, so a locale added to `LOCALES` and
not to `bundles.ts` is a type error rather than a language that silently renders
English on the phone.
