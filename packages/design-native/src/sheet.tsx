import { Modal, Pressable, View } from "react-native";
import Animated, { FadeIn, ReduceMotion, SlideInDown } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { duration } from "@sailo/tokens";
import { Icon } from "./icon";
import { slopTo } from "./theme/components";
import { curve } from "./theme/motion";
import { Text } from "./text";

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
   * What a screen reader calls the close button.
   *
   * Added by A01 rather than published by A00, and optional for the same reason
   * `ErrorState.retryLabel` is: the contract is frozen, and a required prop
   * would break every screen already compiled against it. Pass it — the
   * fallback is English. See the note on `CLOSE_FALLBACK`.
   *
   * @default "Close", untranslated
   */
  closeLabel?: string;
  testID?: string;
};

/**
 * The second and last English literal in this package.
 *
 * Same cause as `ErrorState`'s: the close button needs a name for a screen
 * reader, `SheetProps` had nowhere to put one, and this package cannot reach
 * `@sailo/i18n/native` because that is A05's unmerged work. It is invisible on
 * screen — the button is an icon — so the cost falls entirely on a VoiceOver
 * user in another language, which is the reason it is in the handoff rather
 * than quietly left.
 */
const CLOSE_FALLBACK = "Close";

export function Sheet({
  visible,
  onClose,
  children,
  title,
  size = "auto",
  /*
   * Defaults to true: a sheet is dismissible unless a screen says otherwise.
   * The prop reads as "may be dismissed", so `false` is the deliberate act of
   * taking the way out away, which is what its doc comment asks for.
   */
  dismissible = true,
  closeLabel,
  testID,
}: SheetProps) {
  styles.useVariants({ size });

  return (
    <Modal
      visible={visible}
      transparent
      /*
       * `none`, because the animation is Reanimated's below. Modal's own slide
       * is a JS-driven `Animated` on Android and cannot be told about Reduce
       * Motion; the entering animations here run on the UI thread and carry
       * `ReduceMotion.System`, so a seller who has asked for stillness gets a
       * sheet that is simply there.
       */
      animationType="none"
      /* Android's back button and the iOS swipe both land here. */
      onRequestClose={onClose}
      statusBarTranslucent
      testID={testID}
    >
      <View style={styles.root}>
        <Animated.View
          style={styles.scrim}
          entering={FadeIn.duration(duration.base).easing(curve.outQuint).reduceMotion(ReduceMotion.System)}
        >
          {/*
           * The scrim is the dismiss target, and it is hidden from screen
           * readers: an enormous unlabelled button covering the screen is
           * noise, and VoiceOver users dismiss with the two-finger scrub or
           * the close button. `dismissible: false` makes it inert rather than
           * removing it, so the sheet still has a backdrop.
           */}
          <Pressable
            style={styles.scrimTouch}
            onPress={dismissible ? onClose : undefined}
            disabled={!dismissible}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </Animated.View>

        <Animated.View
          style={styles.panel}
          entering={SlideInDown.duration(duration.slow).easing(curve.outExpo).reduceMotion(ReduceMotion.System)}
          accessibilityViewIsModal
        >
          {/*
           * The grab handle is drawn even when `dismissible` is false, because
           * it is also what says "this is a sheet, it came from the bottom".
           * It is decoration and carries no touch of its own.
           */}
          <View style={styles.handle} />

          {title || dismissible ? (
            <View style={styles.header}>
              {title ? (
                <Text variant="heading" heading numberOfLines={1}>
                  {title}
                </Text>
              ) : (
                <View style={styles.headerSpacer} />
              )}

              <Pressable
                onPress={onClose}
                hitSlop={slopTo(24)}
                accessibilityRole="button"
                accessibilityLabel={closeLabel ?? CLOSE_FALLBACK}
              >
                <Icon name="close" size="md" tone="muted" />
              </Pressable>
            </View>
          ) : null}

          <View style={styles.content}>{children}</View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  /*
   * Written out rather than `absoluteFillObject`, which Unistyles types as a
   * registered style rather than a plain object. `start`/`end` instead of
   * `left`/`right` while we are here — a full-bleed scrim does not care, but
   * the rule holding everywhere is what stops it being a judgement call.
   */
  scrim: {
    position: "absolute",
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    backgroundColor: theme.colors.scrim,
  },
  scrimTouch: {
    flex: 1,
  },
  panel: {
    backgroundColor: theme.colors.surfaceElevated,
    /*
     * Only the top corners. `borderStartStartRadius` and its sibling are the
     * logical spelling, so the pair stays at the top in both directions —
     * `borderTopLeftRadius` would be the bottom corner in a mirrored layout on
     * platforms that swap it.
     */
    borderStartStartRadius: theme.components.sheet.radius,
    borderEndStartRadius: theme.components.sheet.radius,
    paddingHorizontal: theme.components.sheet.paddingInline,
    /*
     * The home indicator eats the bottom of the panel. `rt.insets.bottom` is
     * live, so a phone with no indicator gets the plain padding and one with
     * an indicator gets clearance rather than a button under it.
     */
    paddingBottom: theme.components.sheet.paddingBlock + rt.insets.bottom,
    paddingTop: theme.space.sm,

    variants: {
      size: {
        /* Hugs its content, and stops short of the status bar regardless. */
        auto: { maxHeight: rt.screen.height * theme.components.sheet.heightFraction.large },
        medium: { height: rt.screen.height * theme.components.sheet.heightFraction.medium },
        large: { height: rt.screen.height * theme.components.sheet.heightFraction.large },
      },
    },
  },
  handle: {
    alignSelf: "center",
    width: theme.components.sheet.handleWidth,
    height: theme.components.sheet.handleHeight,
    borderRadius: 999,
    backgroundColor: theme.colors.borderStrong,
    marginBottom: theme.space.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.md,
    paddingBottom: theme.space.md,
  },
  /* Keeps the close button on the trailing edge when there is no title. */
  headerSpacer: {
    flexGrow: 1,
  },
  content: {
    flexShrink: 1,
  },
}));
