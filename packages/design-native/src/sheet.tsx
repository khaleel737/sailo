import { useEffect, useRef, useState } from "react";
import { Animated, Modal, Pressable, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconButton } from "./icon-button";
import { Text } from "./text";
import { ease, useReducedMotion } from "./motion";
import { useTheme } from "./theme";

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
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduced = useReducedMotion();

  /* The `Modal` outlives `visible`, so the exit animation has frames to run
     in — React Native's own `animationType` cannot be used here, see below. */
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    if (!mounted) return;

    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: reduced ? motion.fast : motion.slow,
      easing: ease.outExpo,
      useNativeDriver: true,
    });

    animation.start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });

    return () => animation.stop();
  }, [visible, mounted, progress, reduced, motion.slow, motion.fast]);

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
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            insetInlineStart: 0,
            insetInlineEnd: 0,
            backgroundColor: colors.scrim,
            opacity: progress,
          }}
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
          style={{
            backgroundColor: colors.surfaceElevated,
            borderTopLeftRadius: radius["3xl"],
            borderTopRightRadius: radius["3xl"],
            borderCurve: "continuous",
            paddingTop: space.sm,
            paddingBottom: insets.bottom + space.md,
            paddingHorizontal: space.md,
            gap: space.md,
            ...(size === "medium" ? { minHeight: "50%" } : null),
            ...(size === "large" ? { height: "90%" } : null),
            ...(shadow.overlay ? { boxShadow: shadow.overlay } : null),
            /* Dark mode draws no shadow, so the sheet's top edge is the only
               thing separating it from the page — see `theme.ts`. */
            ...(shadow.overlay ? null : { borderTopWidth: 1, borderColor: colors.border }),
            transform: [
              {
                /* Travels its own height, so a short sheet is not left
                   hanging half off-screen at the start of the animation and a
                   tall one does not have to cross the whole display. */
                translateY: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [reduced ? 0 : height, 0],
                }),
              },
            ],
            opacity: reduced ? progress : 1,
          }}
        >
          {/* The grabber. Non-interactive on its own — the scrim and the header
              button are what close the sheet — but it is the affordance that
              says "this slides". */}
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

          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}
