import { render, screen, waitFor } from "@testing-library/react-native";
import { BrandSplash, MARK_RATIO } from "@sailo/design-native";

/**
 * The first second of the app.
 *
 * WHAT THIS COVERS THAT NOTHING ELSE CAN
 *
 * The session is read from the keychain, so on a cold start there is a real
 * moment where "is anybody signed in" has no answer. Four screens handled that
 * moment identically and wrongly — a bare `ActivityIndicator` on an unpainted
 * background — so the launch sequence was: the native splash, a white flash, a
 * spinner, and then either the app or a sign-up prompt.
 *
 * `BrandSplash` covers it. The two properties that make it a cover rather than
 * a gate are asserted here, because both are invisible in a screenshot and both
 * are the kind of thing a later edit removes by accident:
 *
 *   - it lets taps through for its whole life, so the app underneath is live;
 *   - it takes itself down, exactly once, and tells the caller when.
 */

describe("BrandSplash", () => {
  it("names the product for a screen reader while it is up", () => {
    render(<BrandSplash visible testID="splash" />);
    expect(screen.getByTestId("splash").props.accessibilityLabel).toBe("Sailo");
  });

  /*
   * `pointerEvents="none"` for its whole life. The app underneath is mounted
   * and interactive the entire time — that is the point of covering rather than
   * gating — so a tap landing in the last 200ms of the fade has to reach the
   * button it looks like it is over.
   */
  it("never eats a tap meant for the app underneath", () => {
    render(<BrandSplash visible testID="splash" />);
    expect(screen.getByTestId("splash").props.pointerEvents).toBe("none");
  });

  /*
   * The whole reason it exists is to go away. A cover that outlives the thing
   * it is covering is a launch screen that never ends, and the failure mode is
   * an app that appears to hang on a green screen.
   */
  it("takes itself down once the app knows what to show", async () => {
    const onHidden = jest.fn();
    const { rerender } = render(
      <BrandSplash visible onHidden={onHidden} testID="splash" />,
    );
    expect(screen.getByTestId("splash")).toBeTruthy();

    rerender(<BrandSplash visible={false} onHidden={onHidden} testID="splash" />);

    await waitFor(() => expect(onHidden).toHaveBeenCalled(), { timeout: 5000 });
    expect(screen.queryByTestId("splash")).toBeNull();
  });

  /*
   * It draws a tagline when it is given one and nothing when it is not — a
   * sentence on a screen that is up for 700ms is a sentence nobody finishes
   * reading, so it is the caller's call rather than the component's.
   */
  it("draws the tagline it was handed", () => {
    render(<BrandSplash visible tagline="Your shop, in your pocket." testID="splash" />);
    expect(
      screen.getByText("Your shop, in your pocket.", { includeHiddenElements: true }),
    ).toBeTruthy();
  });
});

describe("the handover from the native launch image", () => {
  /*
   * THE NUMBER THIS FILE EXISTS TO PIN.
   *
   * `app.json` fits `assets/splash-icon.png` with `resizeMode: "contain"`,
   * which on a portrait phone scales the 1024×1024 image to the screen's
   * *width*. The drawing inside that image occupies rows 337–687 — measured
   * from the asset's own alpha channel — which is 34.18% of its height, centred
   * on both axes. So the mark the operating system draws is exactly
   * `screenWidth × 0.3418` tall, and `BrandSplash` reproduces it at that size
   * so there is nothing to see at the handover.
   *
   * If the asset is ever redrawn, this constant moves with it. A test that
   * merely asserted "the splash renders a mark" would keep passing while the
   * seam reopened.
   */
  it("keeps the ratio the asset was measured at", () => {
    expect(MARK_RATIO).toBeCloseTo((687 - 337) / 1024, 4);
  });

  /*
   * Both halves of the pair have to agree, and they live in two different
   * files: the ratio above is in the design system, the `contain` fit and the
   * background are in `app.json`. A `cover` fit would scale to the *longer*
   * edge, which on a tall handset crops the image and moves the mark — so the
   * in-app splash would draw a mark of a different size in the same place, and
   * the handover would visibly jump.
   */
  it("is fitted the way the ratio assumes", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- reading
    // the manifest is the point of the assertion.
    const config = require("../app.json") as {
      expo: {
        backgroundColor: string;
        splash: { resizeMode: string; backgroundColor: string; dark: { backgroundColor: string } };
      };
    };

    expect(config.expo.splash.resizeMode).toBe("contain");

    /*
     * And the ground it is drawn on has to be the app's own page colour, in
     * both modes — `ink-50` and `ink-950`. A launch image on white handing over
     * to an app whose first screen is `#faf9f7` is a frame of the wrong colour
     * at the exact moment the seller is looking hardest.
     */
    expect(config.expo.splash.backgroundColor.toLowerCase()).toBe("#faf9f7");
    expect(config.expo.splash.dark.backgroundColor.toLowerCase()).toBe("#0d0d0c");
    expect(config.expo.backgroundColor.toLowerCase()).toBe("#faf9f7");
  });
});
