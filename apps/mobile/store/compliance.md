# Compliance answers

The four questionnaires nobody can answer from memory, answered against what
the code actually does, with the line of code each answer came from. Re-derive
them when a dependency is added — not from this file, from the code — and then
correct this file.

Verified against the mobile app on 2026-08-14.

---

## 1. App Privacy (App Store Connect)

Answered per data type, then per use. Sailo's mobile app is a **seller** tool,
so most of what it displays — orders, buyers, takings — belongs to the seller's
business and is fetched, not collected from the person holding the phone. The
answers below are only about what the app collects *from its user*.

### Collected, linked to the user's identity

| Data type | What it is | Purpose | Tracking? |
|---|---|---|---|
| Contact Info → Email Address | The account the seller signs in with | App Functionality | No |
| Contact Info → Name | Shown on the Settings screen | App Functionality | No |
| Identifiers → User ID | The account id, in the session cookie | App Functionality | No |
| Identifiers → Device ID | The Expo push token, so an order can reach the lock screen | App Functionality | No |
| User Content → Photos or Videos | Product photos the seller uploads | App Functionality | No |
| User Content → Other User Content | Product names, descriptions and prices the seller writes | App Functionality | No |

The push token is the only device-scoped identifier the app sends, and it goes
one place: `push.register`, which takes exactly `{ token, platform }` — see
`packages/api/src/routers/push.ts`. Nothing derives a fingerprint, and
`expo-device` is read only to answer "is this a simulator", where push tokens
do not exist.

### Not collected

| Data type | Why not |
|---|---|
| Financial Info → Payment Info | Stripe Connect onboarding opens Stripe's own hosted pages in a browser. Card and bank details are entered there, never in the app. |
| Location | No location permission, no location API. |
| Health & Fitness, Sensitive Info, Contacts, Browsing History, Search History | Nothing reads them. |
| Usage Data | No analytics SDK is installed in `apps/mobile`. `@sailo/analytics` is server-side query code; the Google Analytics on the marketing site is the website's, not the app's. |
| Diagnostics → Crash Data | See below. |

### Diagnostics — the answer that will change

`apps/mobile/app/_layout.tsx` calls `init()` from `@sailo/observability` with
no arguments, and that package's default sink is `console`. Nothing leaves the
device. So today: **crash data is not collected.**

The moment a Sentry DSN (or any other sink) is passed to that `init()` call,
the answer becomes *Diagnostics → Crash Data, collected, not linked to
identity, App Functionality* — and App Privacy has to be updated **before** the
build that does it is submitted. Wiring the sink is a one-line change in a file
nobody thinks of as privacy-relevant, which is exactly why it is written down
here.

### Tracking

**No.** Nothing in the app is used to track the user across other companies'
apps or websites, no advertising identifier is read, and there is no third
party that would receive one. No `AppTrackingTransparency` prompt is needed,
and adding one would be worse than pointless — Apple rejects apps that ask for
permission they do not use.

### If social login ever ships

`docs/mobile/A13-social-server.md` and `A14-social-mobile.md` are deferred, and
Apple's rule is that once Google sign-in ships, Sign in with Apple becomes
mandatory. **Both change these answers**: you begin receiving data about a
person from a third party, which is a new source under App Privacy even when
the fields are the same email and name you already had. `usesAppleSignIn` in
`app.json` is `false` today and would have to flip with it. Do not ship A13/A14
without revisiting this section.

---

## 2. Privacy manifest (`PrivacyInfo.xcprivacy`)

Apple requires a declared reason for a short list of APIs — file timestamps,
disk space, system boot time, `UserDefaults` — from the app and from every SDK
it embeds. A missing declaration is `ITMS-91053`, which arrives as an email
after the upload rather than as a build failure.

### What the dependencies declare today

Read out of the manifests in `node_modules`, not assumed. Every one of them
also declares `NSPrivacyTracking: false`, no tracking domains, and no collected
data types — so nothing in this dependency set contributes an App Privacy
answer of its own.

| Package | Category | Reason codes |
|---|---|---|
| `expo-application` | FileTimestamp | `C617.1` |
| `expo-constants` | UserDefaults | `CA92.1` |
| `expo-device` | SystemBootTime | `35F9.1` |
| `expo-file-system` | FileTimestamp, DiskSpace | `0A2A.1` `3B52.1`, `E174.1` `85F4.1` |
| `expo-notifications` | UserDefaults | `CA92.1` |
| `expo-system-ui` | UserDefaults | `CA92.1` |
| `react-native` (core, `cxxreact`) | FileTimestamp, UserDefaults | `C617.1`, `CA92.1` |
| `RCT-Folly`, `glog` | FileTimestamp | `C617.1` |
| `boost` | FileTimestamp, SystemBootTime | `C617.1`, `35F9.1` |

The union is FileTimestamp, UserDefaults, DiskSpace and SystemBootTime — all
four of the categories anything in this dependency set could plausibly touch.

### The gap worth knowing about

**Seven installed packages with native iOS code ship no manifest at
all**: `expo-updates`, `expo-secure-store`, `expo-image`, `expo-web-browser`, `expo-linking`,
`react-native-screens` and `react-native-safe-area-context`. Most of those have
no reason to need one — `expo-secure-store` is Keychain, which is not a
required-reason API, and the layout packages touch neither disk nor defaults.

`expo-updates` and `expo-image` are the two to watch: both write to disk and
manage a cache, which is what FileTimestamp and DiskSpace exist for. Neither is
on Apple's list of designated SDKs that *must* carry a manifest, so this is not
a rejection — but it is the shape of an `ITMS-91053` email naming a framework
you did not write.

### What is not automatic

`@expo/config-plugins`' `withPrivacyInfo` writes an *app-level* manifest only
when `expo.ios.privacyManifests` is set in `app.json`. Read
`node_modules/@expo/config-plugins/build/ios/PrivacyInfo.js`: the first thing
it does is return the config unchanged when that key is absent. It is absent.

That is defensible today — the app's own code calls no required-reason API
directly, reads no file timestamps, queries no disk space, and keeps its
session in the Keychain rather than in `UserDefaults`. It is also the one place
a gap in a dependency can be covered, and covering it pre-emptively costs
nothing. The block to add:

```jsonc
// app.json → expo.ios
"privacyManifests": {
  "NSPrivacyAccessedAPITypes": [
    { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryFileTimestamp",
      "NSPrivacyAccessedAPITypeReasons": ["C617.1"] },
    { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults",
      "NSPrivacyAccessedAPITypeReasons": ["CA92.1"] },
    { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryDiskSpace",
      "NSPrivacyAccessedAPITypeReasons": ["E174.1"] },
    { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategorySystemBootTime",
      "NSPrivacyAccessedAPITypeReasons": ["35F9.1"] }
  ]
}
```

`app.json` is outside this work order's paths, so this is a recommendation
rather than a change — item 4 in the README's blocked list.

### Checking it against a build rather than against this table

`verify-artifact.sh` lists every `PrivacyInfo.xcprivacy` in the built `.ipa`.
Run it after each production build and read the list against the table above;
a dependency added since this was written shows up as a row that is not here.
The authoritative check is still the upload: if `ITMS-91053` does not arrive,
Apple is satisfied.

---

## 3. Export compliance

Sailo uses HTTPS and nothing else: no custom cryptography, no VPN, no
encrypted local storage beyond the OS keychain that `expo-secure-store` wraps.
That is the standard exemption, and the correct answer to App Store Connect's
question is **"Yes, uses encryption"** → **"Only HTTPS / standard exemptions"**
→ no CCATS, no year-end self-classification report.

Answer it in the binary rather than in the web form:

```jsonc
// app.json → expo.ios.infoPlist
"ITSAppUsesNonExemptEncryption": false
```

**It is not there today.** Without it, every upload — including a hotfix at
midnight — stops on the manual questionnaire before a tester can see it.
`verify-artifact.sh` fails the build on its absence. `app.json` is outside this
work order's paths; this is item 3 in the README's blocked list.

---

## 4. Google Play Data Safety

The same facts in Google's shape. Google asks two extra questions Apple does
not.

| Section | Answer |
|---|---|
| Personal info → Name, Email address | Collected, **shared: no**, required, App functionality, account management |
| Personal info → User IDs | Collected, shared: no, required, App functionality |
| Device or other IDs | Collected (push token), shared: no, optional, App functionality — the seller can turn notifications off |
| Photos and videos | Collected, shared: no, optional, App functionality |
| Financial info | Not collected |
| Location | Not collected |
| App activity, App info and performance | Not collected — see the Diagnostics note above |
| **Data is encrypted in transit** | Yes — HTTPS, everywhere, with no cleartext exception in the manifest |
| **Users can request data deletion** | Yes, **in the app**, and a URL: `https://sailo.store/privacy` |

That last row is the one to be careful with. Google accepts either a URL or an
in-app path, and Apple requires the in-app path outright — so answering "yes,
in the app" commits you to the Settings entry point that does not exist yet.
Do not tick it before item 1 in the README's blocked list is done.

---

## Re-check this when

- a package with an `ios/` or `android/` directory is added
- `@sailo/observability`'s `init()` is given a real sink
- social login ships (A13/A14)
- any new permission string appears in `app.json`
- the app starts writing anything to `UserDefaults` or reading file metadata
