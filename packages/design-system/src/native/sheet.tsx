import { useContext, useEffect, useState } from "react";
import { Modal, Pressable, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { IconButton } from "./icon-button";
import { Text } from "./text";
import { useLayout } from "./layout";
import { useReducedMotion } from "./motion";
import { motion as motionTokens, useTheme } from "./theme";

/**
 * The panel that comes up from the bottom.
 *
 * Controlled, not imperative: `visible` is the screen's state. A sheet that
 * opened itself would be a second source of truth about what is on screen, and
 * the back gesture, the scrim tap and the close button would each have to find
 * their way to it.
 *
 * `onClose` is called by all three of those. A sheet a seller cannot dismiss by
 * tapping outside it is a sheet they will force-quit the app to escape.
 */
export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Drawn in the sheet's own header, with the close button. */
  title?: string;
  /**
   * `auto` hugs its content — pickers, confirmations. `large` is near
   * full-height for something that scrolls.
   * @default "auto"
   */
  size?: "auto" | "medium" | "large";
  /**
   * Refuse the scrim tap and the swipe-down, leaving only an explicit control.
   * For a sheet with unsaved input — and for nothing else, because it takes
   * away the way out a seller expects.
   */
  dismissible?: boolean;
  /**
   * What the close button says to a screen reader, in the seller's language.
   *
   * Required for the same reason `ErrorState` takes its retry label: this
   * package has no dictionary and cannot have one, so a default of "Close"
   * here is English inside thirty-five translated apps. The fallback exists
   * only so a test can render one.
   */
  closeLabel?: string;
  testID?: string;
};

/**
 * The exit curve, built from Reanimated's own `Easing`.
 *
 * It cannot be `ease.outExpo` from `./motion`, and the reason is not style.
 * That table is built with **React Native's** `Easing`, whose functions are
 * ordinary JavaScript closures — and Reanimated runs its animations in a
 * worklet on the UI thread, where an ordinary closure is not callable. Passing
 * one throws `The easing function is not a worklet` at runtime, which is a
 * blank screen, and it throws at runtime only: the types are identical, so
 * `tsc` is happy and so is every test that does not mount the sheet on a
 * device.
 *
 * The four control points are the same ones `@sailo/design-system` holds and
 * `globals.css` prints, so this sheet and the web's decelerate identically —
 * only the function wrapping them differs.
 */
const EASE_OUT_EXPO = Easing.bezier(...motionTokens.curve.outExpo);

/**
 * How far down a sheet has to be dragged before letting go dismisses it.
 *
 * A third of its height. Less and a sheet falls off the screen when somebody
 * meant to scroll it; more and a deliberate drag springs back, which reads as
 * the sheet refusing to close.
 */
const SHEET_DISMISS_RATIO = 1 / 3;

/**
 * The downward speed, in points per second, that dismisses from any position.
 *
 * A flick is a decision even when it covers no distance, and this is roughly
 * the speed of a deliberate one rather than of a finger drifting off a drag.
 */
const SHEET_FLING_VELOCITY = 800;

export function Sheet({
  visible,
  onClose,
  children,
  title,
  size = "auto",
  dismissible = true,
  closeLabel,
  testID,
}: SheetProps) {
  const { colors, radius, space, shadow, motion } = useTheme();
  /* The context, not the hook: `useSafeAreaInsets()` throws outright when no
     provider is above it, and a sheet rendered in a test should lay out without
     an inset rather than take its subtree down. Same note in `keyboard.ts`. */
  const insetBottom = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
  const { height } = useWindowDimensions();
  /* Only for the width cap below. The sheet's own height still comes from the
     window, because it slides the full height of it regardless. */
  const { maxWidth } = useLayout();
  const reduced = useReducedMotion();

  /* The `Modal` outlives `visible`, so the exit animation has frames to run
     in — React Native's own `animationType` cannot be used here, see below. */
  const [mounted, setMounted] = useState(visible);

  /*
   * REANIMATED HERE, AND `Animated` EVERYWHERE ELSE IN THIS PACKAGE.
   *
   * `motion.ts` sets the rule: its seven hooks are native-driven and work, and
   * rewriting them buys nothing — while a surface that has to *follow a finger*
   * reaches for Reanimated directly. A sheet you can drag away is that surface.
   * The drag has to read the gesture, move the panel, fade the scrim in step,
   * and then decide on release whether to finish or spring back — all of it on
   * the UI thread, because a drag that computes its position in JavaScript is a
   * frame behind the thumb by construction and feels like dragging something
   * heavy through treacle.
   */
  const offset = useSharedValue(height);

  const finish = () => {
    setMounted(false);
  };

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    if (!mounted) return;

    if (visible) {
      offset.value = withTiming(0, {
        duration: reduced ? motion.fast : motion.slow,
        easing: EASE_OUT_EXPO,
      });
      return;
    }

    offset.value = withTiming(
      height,
      { duration: reduced ? motion.fast : motion.slow, easing: EASE_OUT_EXPO },
      (done) => {
        /* Back to JS to unmount the modal. Doing it on the UI thread would set
           React state from a worklet, which is the one thing Reanimated cannot
           do without this hop. */
        if (done) runOnJS(finish)();
      },
    );
  }, [visible, mounted, offset, reduced, motion.slow, motion.fast, height]);

  /**
   * The drag, attached to the header rather than to the whole sheet.
   *
   * A pan over the entire panel is what everybody writes first, and it fights
   * every scrollable thing inside it: the product editor is a form that
   * scrolls, and a downward drag near its top is ambiguous between "scroll up"
   * and "dismiss". Resolving that needs `simultaneousWithExternalGesture` and a
   * scroll-offset check, and the failure mode when it is subtly wrong is a
   * sheet that sometimes eats a scroll.
   *
   * The grabber and the title row are unambiguous — nothing scrolls there, and
   * the grabber is the affordance that already says "this slides". It is also
   * what the platform's own sheets do when their content scrolls.
   */
  const drag = Gesture.Pan()
    .enabled(dismissible && !reduced)
    .onChange((event) => {
      /* Downward only. An upward drag on a sheet that is already at its resting
         position should do nothing rather than lifting it off the bottom edge. */
      offset.value = Math.max(0, offset.value + event.changeY);
    })
    .onEnd((event) => {
      /*
       * Distance *or* speed. A slow drag past a third of the sheet's height is
       * a decision; so is a quick flick from anywhere, which is what a seller
       * dismissing something they have finished with actually does. Requiring
       * distance alone makes a flick spring back, which reads as the sheet
       * refusing.
       */
      const far = offset.value > SHEET_DISMISS_RATIO * height;
      const fast = event.velocityY > SHEET_FLING_VELOCITY;

      if (far || fast) {
        offset.value = withTiming(
          height,
          { duration: motion.base, easing: EASE_OUT_EXPO },
          (done) => {
            if (done) runOnJS(onClose)();
          },
        );
        return;
      }

      /* Back home, on a spring, so a released drag carries its velocity into
         the settle rather than stopping dead and then animating. */
      offset.value = withSpring(0, { velocity: event.velocityY, damping: 26, stiffness: 320 });
    });

  const panel = useAnimatedStyle(() => ({
    transform: [{ translateY: reduced ? 0 : offset.value }],
    opacity: reduced ? interpolate(offset.value, [height, 0], [0, 1]) : 1,
  }));

  /* The scrim tracks the panel rather than running its own timer, which is what
     keeps the two in step *while being dragged* — a scrim on a fixed curve would
     stay at full strength through a drag and then jump. */
  const scrim = useAnimatedStyle(() => ({
    opacity: interpolate(offset.value, [height, 0], [0, 1]),
  }));

  return (
    <Modal
      visible={mounted}
      transparent
      /*
       * `none`, and the sheet animates itself.
       *
       * `animationType="slide"` slides the *whole modal*, scrim included — so
       * the dim arrives already at full strength, travelling up from the bottom
       * of the screen like a grey card. What a sheet is supposed to look like
       * is a scrim fading in place while a panel rises through it, and those
       * are two different curves on two different properties. They cannot be
       * one platform animation, so they are two of ours.
       */
      animationType="none"
      // Android's hardware back closes it, which is the platform's own dismiss
      // and the one thing a custom sheet usually forgets.
      onRequestClose={dismissible ? onClose : undefined}
      // iOS: the status bar belongs to the screen underneath, not to the sheet.
      statusBarTranslucent
      testID={testID}
    >
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Animated.View
          style={[
            {
              position: "absolute",
              top: 0,
              bottom: 0,
              insetInlineStart: 0,
              insetInlineEnd: 0,
              backgroundColor: colors.scrim,
            },
            scrim,
          ]}
        >
          {/* Tapping the scrim closes it, unless the sheet is a decision the
              seller has to actually answer. */}
          <Pressable
            style={{ flex: 1 }}
            onPress={dismissible ? onClose : undefined}
            accessible={false}
          />
        </Animated.View>

        <Animated.View
          style={[{
            backgroundColor: colors.surfaceElevated,
            borderTopLeftRadius: radius["3xl"],
            borderTopRightRadius: radius["3xl"],
            borderCurve: "continuous",
            paddingTop: space.sm,
            paddingBottom: insetBottom + space.md,
            paddingHorizontal: space.md,
            gap: space.md,
            /*
             * The same readable column `Screen` uses, for the same reason.
             *
             * A bottom sheet that spans the window is right on a phone, where
             * the window is 390pt. On an iPad in landscape it is a form whose
             * fields are 1300pt wide and whose buttons sit a foot apart — and
             * it is not what the platform does either: iOS presents a sheet on
             * a regular-width screen as a centred card, not as a bar across the
             * bottom. `undefined` on every phone, so this is one property that
             * does nothing until there is a reason for it.
             */
            ...(maxWidth ? { maxWidth, width: "100%" as const, alignSelf: "center" as const } : null),
            ...(size === "medium" ? { minHeight: "50%" } : null),
            ...(size === "large" ? { height: "90%" } : null),
            ...(shadow.overlay ? { boxShadow: shadow.overlay } : null),
            /* Dark mode draws no shadow, so the sheet's top edge is the only
               thing separating it from the page — see `theme.ts`. */
            ...(shadow.overlay ? null : { borderTopWidth: 1, borderColor: colors.border }),
          }, panel]}
        >
          {/* The grabber and the title are the drag handle — see `drag` above
              for why the gesture is here and not on the whole panel. */}
          <GestureDetector gesture={drag}>
            <View style={{ gap: space.md }}>
              {/* The grabber. Not a control on its own, but the affordance that
                  says "this slides" — and now the thing that actually does. */}
              <View
                style={{
                  alignSelf: "center",
                  width: 36,
                  height: 5,
                  borderRadius: 999,
                  backgroundColor: colors.border,
                }}
              />

              {title ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                  <View style={{ flex: 1 }}>
                    <Text variant="title" heading>
                      {title}
                    </Text>
                  </View>
                  {dismissible ? (
                    <IconButton
                      icon="close"
                      onPress={onClose}
                      accessibilityLabel={closeLabel ?? "Close"}
                      tone="muted"
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          </GestureDetector>

          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}
