# Screenshots

Put the PNGs in this directory and list them in `store.config.json`. Nothing
here is generated — `preflight.sh` check 5 fails until the files exist and are
referenced, because a listing that claims a size it cannot fill is rejected by
App Store Connect before a human ever sees it.

## What is required

`app.json` has `"supportsTablet": false`, so **iPhone 6.7" is the only
mandatory set**. That is the whole iOS requirement: Apple scales one set down
for every smaller device.

| Set | `store.config.json` key | Pixels (portrait) | How many |
|---|---|---|---|
| iPhone 6.7" / 6.9" | `APP_IPHONE_67` | 1290 × 2796 | 3 minimum, 10 maximum. Ship 5. |

Also accepted in that set: 1320 × 2868, 1284 × 2778, 1206 × 2622. Pick one and
use it for every shot — a set with mixed dimensions is rejected.

**If `supportsTablet` ever goes back to `true`,** iPad 13" screenshots
(`APP_IPAD_PRO_3GEN_129`, 2064 × 2752) become mandatory *and* the app has to
genuinely work on iPad. `preflight.sh` reads `app.json` and starts requiring
them on its own, so the gate will tell you. It cannot make the app work on
iPad.

For Google Play, the same PNGs are fine: 2 to 8 phone screenshots, and
separately a 1024 × 500 feature graphic and a 512 × 512 icon, neither of which
lives in `store.config.json` — those are uploaded in the Play Console.

## The shots

Five, in this order, because the order is the argument: this is a shop that
already happened, and here is what you can do to it from a phone.

1. **Orders.** The list, populated, with a mix of statuses. The single most
   convincing screen — it is what a seller opens the app for.
2. **Order detail.** Lines, totals, buyer. Shows the app is not a viewer.
3. **Check-in.** The scanner with a door list behind it. The reason this is a
   native app and not the website.
4. **Store.** Products with photos, one with variants.
5. **Insights.** A chart with real shape in it.

Capture them from the reviewer's seeded shop (`reviewer.md`) so every screen is
full, and so the screenshots and the demo account tell the same story.

**Nothing in a screenshot may show a price for a Sailo plan, an upgrade
button, or a route to one.** The rule that governs the binary governs the
listing — Apple reads the screenshots. Product prices belonging to the seller's
own shop are the whole point and are fine.

## Capturing them

From a booted simulator on an iPhone 16 Pro Max (1290 × 2796):

```sh
# 9:41, full battery, full bars — the same clean status bar in every shot,
# so five screenshots do not look like five different afternoons.
xcrun simctl status_bar booted override \
  --time 9:41 --batteryState charged --batteryLevel 100 \
  --cellularBars 4 --wifiBars 3

xcrun simctl io booted screenshot apps/mobile/store/screenshots/01-orders.png
```

Capture from a **production or preview build**, not from Expo Go with a dev
server: the dev overlay, a different font fallback and a localhost banner have
all shipped to a store listing before.

## Wiring them up

Paths are relative to `apps/mobile`. Add to `store.config.json` under
`apple.info["en-US"]`:

```json
"screenshots": {
  "APP_IPHONE_67": [
    "./store/screenshots/01-orders.png",
    "./store/screenshots/02-order-detail.png",
    "./store/screenshots/03-checkin.png",
    "./store/screenshots/04-store.png",
    "./store/screenshots/05-insights.png"
  ]
}
```

Then `apps/mobile/store/preflight.sh` to confirm every file resolves, and
`eas metadata:push` to upload.

## Adding a language

The app ships in thirty-five languages, and the listing ships in one. That is
deliberate: a second locale in `store.config.json`'s `info` needs its own
complete screenshot set, its own description and its own keywords, and a
half-filled locale is worse than an absent one. If you add one, add all of it.
