import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from "react-native";
import { BrandMark, Wordmark } from "./brand";
import { ease } from "./motion";
import { useReducedMotion } from "./motion";
import { useTheme } from "./theme";

/**
 * The first second of the app, and the flicker it exists to remove.
 *
 * WHAT THIS ACTUALLY FIXES
 *
 * The session lives in the keychain, so on a cold start there is a real moment
 * where the answer to "is anybody signed in" is "not yet". Four files handled
 * that moment and all four handled it the same wrong way — a bare
 * `ActivityIndicator` on an unpainted background. So the launch sequence was:
 * the native splash, then a white flash, then a spinner, then either the app or
 * a sign-up prompt. On a warm start the spinner is visible for two frames,
 * which reads as the app stuttering rather than as it loading.
 *
 * This replaces the middle three. The native launch image hands over to a view
 * that is drawing *the same mark at the same size in the same place*, so there
 * is nothing to see at the handover; it holds while the keychain is read; then
 * it lifts.
 *
 * HOW THE HANDOVER IS SEAMLESS WITHOUT `expo-splash-screen`
 *
 * That package is not installed and adding it is a native dependency, a
 * regenerated lockfile and a dev-client rebuild for everyone working in this
 * tree — for one function. It is not needed, because the seam can be closed
 * from the other side: `app.json` fits `splash-icon.png` with `contain`, which
 * on a portrait phone scales the 1024×1024 image to the screen's *width*. The
 * mark inside that image is centred and occupies a measured 34.18% of its
 * height. So the mark the operating system is drawing is exactly
 * `screenWidth × 0.3418` tall and dead centre — which is what `MARK_RATIO`
 * below reproduces. Change the asset and this number changes with it; the two
 * are checked against each other in `splash.test.tsx`.
 */

/**
 * The mark's height as a fraction of the screen's width, when `app.json` fits
 * `splash-icon.png` with `contain`.
 *
 * Measured from the asset's alpha channel rather than guessed: the drawing
 * occupies rows 337–687 of a 1024px-tall image, centred on both axes.
 */
export const MARK_RATIO = 0.3418;

export type BrandSplashProps = {
  /**
   * Whether the app is still deciding what to show.
   *
   * Drive it from the thing that is genuinely pending — the session read — not
   * from a timer. A splash held by a timer is a splash that is sometimes still
   * up after the app is ready and sometimes gone before it is.
   */
  visible: boolean;
  /**
   * The tagline under the wordmark, in the seller's language.
   *
   * Optional, and leaving it out is a reasonable choice: the mark and the word
   * are the brand, and a sentence on a screen that is up for 700ms is a
   * sentence nobody finishes reading.
   */
  tagline?: string;
  /** Called once the exit animation has finished and nothing is left on top. */
  onHidden?: () => void;
  testID?: string;
};

/**
 * The shortest the splash may be up once it has been shown.
 *
 * A warm start resolves the session in under a frame, and without a floor the
 * splash mounts and unmounts inside one — which is a flash of green, not a
 * launch. 420ms is long enough to read as deliberate and short enough that
 * nobody who is trying to get to their orders notices they waited.
 */
const MINIMUM_MS = 420;

export function BrandSplash({ visible, tagline, onHidden, testID }: BrandSplashProps) {
  const { colors, motion, space } = useTheme();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();

  /* Separate from `visible`: the overlay outlives it by the length of the exit
     animation, and unmounting on the prop would cut that animation off at the
     first frame. */
  const [mounted, setMounted] = useState(true);
  const shownAt = useRef(Date.now());

  /* One value drives everything. 1 is "fully covering", 0 is "gone". */
  const cover = useRef(new Animated.Value(1)).current;
  /* The lockup's own entrance, which runs while the splash is still up. */
  const reveal = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      reveal.setValue(1);
      return;
    }
    const animation = Animated.timing(reveal, {
      toValue: 1,
      duration: motion.slow,
      /* A beat before the word appears, so the mark reads as having been there
         first — which it was, on the native launch image. */
      delay: 120,
      easing: ease.outExpo,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [reveal, reduced, motion.slow]);

  useEffect(() => {
    if (visible) return;

    const elapsed = Date.now() - shownAt.current;
    const wait = Math.max(0, MINIMUM_MS - elapsed);

    const animation = Animated.timing(cover, {
      toValue: 0,
      duration: reduced ? motion.base : motion.splash,
      delay: wait,
      /* `outExpo`: almost all of the movement happens in the first third, so
         the app underneath is legible well before the overlay has finished
         leaving. A linear fade would keep a translucent green film over the
         first screen for half a second. */
      easing: reduced ? Easing.linear : ease.outExpo,
      useNativeDriver: true,
    });

    animation.start(({ finished }) => {
      if (!finished) return;
      setMounted(false);
      onHidden?.();
    });

    return () => animation.stop();
  }, [visible, cover, reduced, motion.splash, motion.base, onHidden]);

  if (!mounted) return null;

  /*
   * The exact height the operating system just drew the mark at.
   *
   * The *shorter* side, not the width — and on a portrait phone those are the
   * same number, which is why `width` was right for as long as the app was
   * portrait-only. `contain` fits a square image inside the window by whichever
   * side is smaller: in portrait that is the width, in landscape it is the
   * height. On an iPad held sideways `width` is the long edge, so this drew the
   * mark around a third larger than the one the system had just drawn behind
   * it, and the handover this whole component exists to hide became a visible
   * jump on the first frame.
   */
  const markSize = Math.min(width, height) * MARK_RATIO;

  return (
    <Animated.View
      /*
       * `pointerEvents="none"` for the whole life of the overlay.
       *
       * The app underneath is mounted and interactive the entire time — that is
       * the point of covering rather than gating. A tap that lands in the last
       * 200ms of the fade should reach the button it looks like it is over.
       */
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        {
          backgroundColor: colors.background,
          alignItems: "center",
          justifyContent: "center",
          gap: space.xl,
          opacity: cover,
          transform: [
            {
              /*
               * The overlay lifts *towards* the viewer as it goes.
               *
               * 1 → 1.04, which is small enough that nothing appears to move
               * and large enough that the departure has a direction. The
               * alternative — a flat cross-fade — reads as a dissolve, and a
               * dissolve is what a *transition between two screens* looks
               * like, not what a cover being removed looks like.
               */
              scale: reduced
                ? 1
                : cover.interpolate({ inputRange: [0, 1], outputRange: [1.04, 1] }),
            },
          ],
        },
      ]}
      /*
       * Announced as one thing, and only while it is up.
       *
       * Without this VoiceOver focus lands on the app underneath — which is
       * correct, and also means the first thing a screen-reader user hears on
       * a cold start is a half-loaded screen. The label is the product's name
       * because that is genuinely all this screen says.
       */
      accessible
      accessibilityRole="image"
      accessibilityLabel="Sailo"
      accessibilityViewIsModal
      testID={testID}
    >
      <View style={{ alignItems: "center", gap: space.lg }}>
        {/*
          Not animated, and that is the whole trick: this is the frame the
          native launch image was already showing. Anything that moves here —
          a fade in, a scale from zero — announces that a *second* splash has
          started, which is exactly the seam this component exists to hide.
        */}
        <BrandMark size={markSize} tone="brand" />

        <Animated.View
          style={{
            alignItems: "center",
            gap: space.sm,
            opacity: reveal,
            transform: [
              {
                translateY: reduced
                  ? 0
                  : reveal.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
              },
            ],
          }}
        >
          <Wordmark height={26} tone="brand" />
          {tagline ? <Tagline text={tagline} /> : null}
        </Animated.View>
      </View>
    </Animated.View>
  );
}

/**
 * Split out only so the type ramp is reachable without importing `Text` into a
 * file that would then have a circular-looking dependency on the theme it
 * already reads. It is one line of copy under a wordmark.
 */
function Tagline({ text }: { text: string }) {
  const { colors, type } = useTheme();
  return (
    <Animated.Text
      style={[type.caption, { color: colors.contentMuted, textAlign: "center" }]}
      /* The overlay above carries the accessible name for the whole group. */
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {text}
    </Animated.Text>
  );
}
