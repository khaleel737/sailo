# A12 — Release engineering

**Wave:** 3 · **Effort:** M (1 week + review) · **Depends on:** A11

## Mission

Get the app into the App Store, and give yourself a way to fix things after.

## Owns — exclusive write access

- `apps/mobile/eas.json`
- `.github/workflows/mobile-release.yml` (new)
- Store metadata and assets

## Never touches

Any product code. If submission reveals a code problem, report it back to the
owning agent.

## Context you need

`eas.json` already has `development` / `preview` / `production` profiles with
update channels and `appVersionSource: "remote"`. `app.json` has the EAS
project id (`096eb8c1-…`), owner `khaleel737`, `runtimeVersion.policy:
"appVersion"` and the update URL. `expo-updates` is installed and configured.

That means EAS Update works and JS-only fixes can ship without a review cycle.
Do not break that.

A00 decided iPad (`supportsTablet`). Honour the decision — if it stayed `true`,
iPad screenshots are mandatory and the app must actually work on iPad.

## Tasks

1. **EAS submit credentials** — `ascAppId`, `appleTeamId`, and a Google Play
   service account key. Store secrets in EAS, never in the repo.

   `submit.production` in `eas.json` is currently `{}`. There is no path to
   either store until it is filled in.

2. **Sentry source maps.** `@sentry/react-native`'s config plugin generates
   `ios/sentry.properties` at prebuild, and that file deliberately contains no
   credentials — it falls back to `SENTRY_ORG`, `SENTRY_PROJECT` and
   `SENTRY_AUTH_TOKEN` from the environment. Set all three as **EAS secrets**,
   not repo variables: the auth token can upload artefacts to your Sentry org,
   and `ios/` is gitignored precisely so generated native config never carries a
   credential into the tree.

   **A local build without them does not merely skip the upload — it fails.**
   `sentry-cli` exits non-zero with "An organization ID or slug is required",
   and because its script phase runs *before* the framework-embed phase, the
   app links and then ships without `React.framework` in it. The symptom is not
   a build error anybody reads; it is an app that installs, launches, and dies
   instantly on `dyld: Library not loaded: @rpath/React.framework/React`.

   So local and CI builds that are not releasing set:

   ```
   export SENTRY_DISABLE_AUTO_UPLOAD=true
   ```

   Only the release build should upload, and only it needs the three secrets.

3. **`UIBackgroundModes`.** `ios.infoPlist.UIBackgroundModes` declares
   `remote-notification`, and it has to: `expo-notifications` implements
   `application:didReceiveRemoteNotification:fetchCompletionHandler:`, and iOS
   simply does not call that delegate for an app that has not declared the mode.
   The symptom is not an error — push works perfectly while the app is open and
   silently never arrives when it is backgrounded, which is the only state that
   matters for the feature.

   **`fetch` is deliberately not declared**, though the same console warning
   asks for it. Background App Refresh is a capability App Review asks you to
   justify, and nothing in Sailo needs to run on a timer while closed.

4. **Store assets** — screenshots at every size you claim, app icon, subtitle,
   keywords, description, promotional text.

5. **Compliance** —
   - App Privacy questionnaire (what you collect, linked to identity or not)
   - Privacy manifest — verify Expo's generated `PrivacyInfo.xcprivacy` covers
     every required-reason API your dependencies use
   - Export compliance (you use HTTPS; answer accordingly)
   - Google Play Data Safety form
   - Privacy policy and support URLs — both already live on the web app

6. **Reviewer demo account** — seeded with products, orders, and a live event
   with issued tickets so the reviewer can exercise check-in. A reviewer who
   cannot get past an empty state rejects the build.

7. **Release pipeline** — internal TestFlight → external beta with real
   sellers → phased release.

## The thing that will get you rejected

**Ship no purchase path on iOS.**

Sailo charges sellers $9.99/month (`pro`) and $19.99/month (`business`) through
Stripe Checkout — see `apps/web/src/lib/plans.ts` and
`apps/web/src/lib/actions/billing.ts`. Putting that upgrade flow in the iOS app
triggers Apple's in-app-purchase rules, and the outcome is a 30% cut or a
rejection.

In the app: show the current plan and what each tier unlocks. **No price, no
upgrade button, no link to a checkout page.** A seller upgrades on the web.

Stripe **Connect** onboarding is unaffected and stays in the app — that is a
seller setting up a business account to receive money, not a user buying a
digital good.

## Details that must not be missed

- **Account deletion must be reachable in the app** (Guideline 5.1.1(v)) since
  the app offers sign-up. A04 built `account.delete`; verify Settings exposes
  it and that a reviewer can find it.
- If social login ever ships (A13/A14), **the App Privacy answers change** —
  you begin collecting data from third parties. Note this in the checklist now.
- `runtimeVersion.policy: "appVersion"` means a native change requires a new
  binary and a JS change can go over the air. Document which kinds of fix can
  use EAS Update so nobody tries to ship a native fix through it.
- Phased release, not 100% on day one. You have one push channel and one
  rollback; use them.
- Verify the production build actually points at production —
  `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_AUTH_URL` default to
  `https://sailo.store` but a stale `.env` can override. Check the built
  artifact, not the source.
- Test an EAS Update against a production build **before** submission, not
  after. Discovering the channel is misconfigured while trying to ship a
  hotfix is the worst possible time.

## Done when

- [ ] A production build installs from TestFlight and signs in against
      production.
- [ ] An EAS Update reaches that build.
- [ ] Store listing complete at every claimed size, including iPad if A00 kept
      it.
- [ ] Reviewer account seeded and verified by someone who has not seen the app.
- [ ] No purchase path exists anywhere in the iOS build. Grep for it.
- [ ] Account deletion reachable in three taps from Settings.
- [ ] External beta run with real sellers, feedback triaged.
- [ ] Phased release configured.
