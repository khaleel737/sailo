# Shipping the app

Everything the App Store and Google Play need that is not product code: the
listing, the compliance answers, the reviewer's account, and the gates that
stop a build reaching a store when one of those is wrong.

| File | What it is |
|---|---|
| `../store.config.json` | The App Store listing, as data. `eas metadata:push` writes it to App Store Connect. |
| `no-purchase-path.sh` | The one rule that runs on every pull request. |
| `preflight.sh` | Everything that has to be true before a submit. |
| `verify-artifact.sh` | What is actually inside the binary you are about to upload. |
| `compliance.md` | App Privacy, the privacy manifest, export compliance, Data Safety. |
| `reviewer.md` | The demo account App Review signs in with, and what it must contain. |
| `screenshots/` | The shot list, the sizes, and how to capture them. |

The pipeline that runs them is `.github/workflows/mobile-release.yml`.

`store.config.json` sits beside `eas.json` rather than in here, and that is not
a filing preference. `metadataPath` is resolved against the project directory,
so a nested path loads correctly for `metadata:push` and `metadata:lint` — but
`metadata:pull` builds its output path with `path.basename`, drops the
directory, and writes to `apps/mobile/store.config.json` regardless. Read
`getStaticConfigFilePath` in eas-cli's `build/metadata/config/resolve.js`. A
nested config means pull and push silently read and write different files: you
would fetch the live listing, edit it, push, and push the stale one. Keeping
the file at the default path makes every EAS command agree.

## The thing that gets you rejected

**No purchase path on iOS.** Sailo charges sellers $9.99/month for `pro` and
$19.99/month for `business` through Stripe Checkout — see
`packages/core/src/plans.ts`. Putting that upgrade flow in the iOS app triggers
Apple's in-app-purchase rules under Guideline 3.1.1, and the outcome is a 30%
cut on every subscription or a rejection.

In the app: show which plan the shop is on and what each tier unlocks. **No
price, no upgrade button, no link to a checkout page.** A seller upgrades on
the web.

Stripe **Connect** onboarding stays in the app and is not affected. That is a
seller setting up a business account to receive money from their own buyers,
not a user buying a digital good — a distinction App Review makes as well, and
one `reviewer.md` states explicitly so nobody has to guess.

`no-purchase-path.sh` enforces this on every pull request, and
`verify-artifact.sh` proves it again against the compiled bundle, where the
import graph can no longer surprise anyone.

## Credentials

Nothing secret is in this repo, and nothing secret should ever be added to it.

| What | Where it lives | How it gets there |
|---|---|---|
| App Store Connect API key (`.p8`) | EAS, per project | `eas credentials` → iOS → App Store Connect API Key |
| iOS distribution certificate and profile | EAS, per project | `eas credentials`, or let `eas build` create them |
| Google Play service account JSON | EAS, per project | `eas credentials` → Android → Google Service Account |
| Android upload keystore | EAS, per project | `eas credentials` |
| `EXPO_TOKEN` | GitHub repository secret | expo.dev → account settings → access tokens |

Two values are *not* secrets and do belong in `eas.json`, because
`eas submit --non-interactive` cannot ask for them:

- `ascAppId` — the numeric App Store Connect app id, visible in the ASC URL.
- `appleTeamId` — ten characters, on developer.apple.com under Membership.

Both are `REPLACE_BEFORE_FIRST_SUBMIT` today, because the App Store Connect
app record does not exist yet. They are marked rather than omitted so that
forgetting them fails loudly: EAS refuses the profile with a message naming
exactly what is wrong, and `preflight.sh` catches it before that.

## The release pipeline

Run from GitHub → Actions → **Mobile release** → Run workflow.

1. **Build.** `action: build`. Builds the production profile on both
   platforms, waits, then downloads each artifact and reads it —
   `verify-artifact.sh` checks the origins baked into the bundle, that no plan
   price survived, that the usage strings are present, and prints every
   `PrivacyInfo.xcprivacy` the build ended up with.

2. **Internal TestFlight.** `action: build-and-submit`, `submit_profile:
   production`. Internal testers on your own team get it within minutes and
   without a review. On Android this goes to the Play `internal` track.
   `preflight.sh` runs first and refuses if the listing is not real.

3. **External beta.** `submit_profile: beta`. External TestFlight groups need
   Beta App Review — a day or so, much lighter than App Review. Android's
   `beta` track is open testing. This is where real sellers use it on their own
   shops, which is the only test that finds what the simulator cannot: a slow
   café wifi, a cracked screen, a phone three OS versions behind.

4. **Phased release.** `store.config.json` sets `release.phasedRelease: true`
   and `automaticRelease: false`, so an approved version is released when you
   say so, and then over seven days rather than to everyone at once. For
   Android, `submit_profile: rollout` puts the production track at 10% and
   holds it there — raise it in the Play Console, or halt it.

Nothing goes to 100% on day one. You have one push channel and one rollback;
spend them deliberately.

## What can go over the air, and what cannot

`app.json` sets `runtimeVersion.policy: "appVersion"`. An EAS Update is only
offered to a binary whose app version matches the one the update was published
against. That single line decides which fixes need a review cycle.

**Can go over the air** — anything that is only JavaScript, TypeScript, JSON or
an asset already referenced by the bundle:

- a screen that crashes, a wrong total, a mis-sorted list
- copy, translations, a new string in `@sailo/i18n/native`
- styling, layout, a component from `@sailo/design-native`
- a tRPC call that needs a different shape
- a new screen, as long as it uses no new native module

**Cannot go over the air** — it needs a new binary and a new review:

- adding or removing any package with native code (`expo-camera`,
  `expo-image-picker`, anything with an `ios/` or `android/` directory)
- an Expo SDK or React Native upgrade
- a change to `app.json`: permissions and their usage strings, the icon, the
  splash screen, the bundle identifier, associated domains, intent filters,
  `supportsTablet`, plugins
- **bumping `version` in `app.json`** — that changes the runtime version, so
  every phone already in the field stops matching

The last one is the trap, because it fails silently. Publish an update after a
version bump and EAS reports success; the update simply reaches nobody, and you
find out when the bug you fixed is still being reported a week later. The
`update` job's last step exists for exactly this: it compares the published
runtime version against the latest finished production build and fails the run
if no build can receive it.

**Test an update against a production build before you submit, not after.**
Install the TestFlight build, run `action: update` with a visible cosmetic
change, and watch it arrive. Discovering the channel is misconfigured while
trying to ship a hotfix is the worst possible moment to discover it.

## Rolling back

- **An update.** `eas update:rollback`, or republish the previous commit to the
  `production` branch. Reaches phones on next launch. This is the fast one.
- **A binary.** There is no rollback. You submit a new build, and it waits for
  review like any other. If a native release is bad, the recovery is an EAS
  Update on top of it — which only works if the fix is JavaScript.

That asymmetry is the reason for the phased release. Ten percent of sellers
hitting a native bug is a bad day; all of them is a bad week.

## Done when

- [ ] A production build installs from TestFlight and signs in against
      production.
- [ ] An EAS Update reaches that build.
- [ ] Store listing complete at every claimed size.
      `app.json` has `supportsTablet: false`, so iPhone 6.7" is the only
      required set — see `screenshots/README.md`. If that ever flips back to
      true, iPad screenshots become mandatory *and* the app has to work on
      iPad.
- [ ] Reviewer account seeded and verified by someone who has not seen the app.
- [ ] No purchase path anywhere in the iOS build — enforced by
      `no-purchase-path.sh` on every pull request and by `verify-artifact.sh`
      against the binary.
- [ ] Account deletion reachable in three taps from Settings.
- [ ] External beta run with real sellers, feedback triaged.
- [ ] Phased release configured — `store.config.json` for iOS, the `rollout`
      submit profile for Android.

## Blocked on work outside this directory

None of these are release-engineering changes, and none of them can be made
from here. Each one blocks a submission.

1. **Settings does not expose account deletion.** `account.delete` exists in
   `packages/api/src/routers/account.ts` and does the real work through
   `@sailo/account/deletion`, but `apps/mobile/app/(tabs)/settings/index.tsx`
   never calls it. Guideline 5.1.1(v) requires an app that offers account
   creation to offer account deletion in the app. This is a rejection, not a
   note. `preflight.sh` check 2 fails on it.

2. **`https://sailo.store/support` does not exist.** Apple requires a support
   URL and Google requires a support contact. The URL answers 200 today only
   because `apps/web` routes `/[handle]` as a storefront catch-all, so every
   unclaimed path renders "Shop not found" with a 200 — a plain status check
   would have called it live. It needs a real page carrying
   `support@sailo.store`, which `apps/web/src/lib/legal.ts` already names.
   `preflight.sh` check 4 fails on it.

3. **`ITSAppUsesNonExemptEncryption` is not in `app.json`.** Sailo uses HTTPS
   and nothing else, which is exempt — but the answer has to be in the binary.
   Without it, every single upload stops on a manual export-compliance
   questionnaire before it can reach a tester. The fix is one line in
   `app.json`'s `ios.infoPlist`. `verify-artifact.sh` fails on it.

4. **`app.json` declares no `ios.privacyManifests`.** Seven installed packages
   with native iOS code ship no `PrivacyInfo.xcprivacy` of their own, and two
   of them — `expo-updates` and `expo-image` — manage an on-disk cache, which
   is what the file-timestamp and disk-space reasons exist for. Not a
   rejection, and not certain to matter; it is the shape of an `ITMS-91053`
   email naming a framework nobody here wrote. `compliance.md` has the exact
   four-entry block to paste, and it costs nothing to paste it.

5. **No plan surface in the app.** The app should show which plan the shop is
   on and what each tier unlocks, with no price and no way to buy. No screen
   does this today. Not a rejection — an absence.

6. **The reviewer's shop is not seeded.** `reviewer.md` specifies exactly what
   `review@sailo.store` must contain. Creating it needs a script in
   `apps/web/scripts/` and a run against production.
