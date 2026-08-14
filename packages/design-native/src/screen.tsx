import { Animated, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEntrance } from "./motion";
import { useTheme } from "./theme";
import type { Space } from "./types";

/**
 * The thing every screen in the app is, and the one that was missing.
 *
 * WHAT THIS REPLACES
 *
 * Twelve screens each declared their own `StyleSheet.create({ fill: { flex: 1 },
 * body: { padding: 20, gap: 16 } })` and the note at the foot of
 * `app/(auth)/_layout.tsx` explains why: the package had twenty components and
 * every one of them was *content*, while a screen also needs something that
 * fills the window so a `ScrollView` inside it has a height to scroll against.
 * That exception was supposed to be one grep-able rule per file. It was not:
 * the auth screens padded at 20 and the tab screens at 16, so walking from
 * sign-in into the app visibly shifted the margins, and half the screens set
 * `contentInsetAdjustmentBehavior` while the other half did not.
 *
 * This is that component. Every `styles.fill` in the app is deleted with it.
 *
 * WHAT IT OWNS THAT A SCREEN SHOULD NOT HAVE TO
 *
 *   - **The fill.** `flex: 1`, once.
 *   - **The page colour.** A screen that does not paint `background` is a
 *     screen that is white in dark mode, which is how `components/states.tsx`
 *     came to be unreadable at night.
 *   - **The safe area.** Which edges, and the fact that a screen under a
 *     navigation header must not claim the top one — claiming it twice is the
 *     40pt gap under the header nobody can find the source of.
 *   - **The keyboard.** iOS insets the scroll view; Android resizes the window.
 *     Getting that wrong is a submit button under the keyboard.
 *   - **The rhythm.** One padding scale and one gap, so the margins do not move
 *     between screens.
 *   - **The entrance.** Content fades and rises once on mount, which is what
 *     makes a push read as arriving rather than as a cut.
 */
export type ScreenProps = {
  children: React.ReactNode;
  /**
   * Whether the content scrolls.
   *
   * `false` is for a screen that must not — a camera viewfinder, a screen
   * whose own list does the scrolling. A `FlashList` inside a `ScrollView` is
   * a list with no height, which is the most common way a list renders blank.
   * @default true
   */
  scroll?: boolean;
  /** @default "lg" */
  padding?: Space | "none";
  /** The distance between the blocks stacked inside. @default "lg" */
  gap?: Space | "none";
  /**
   * Which safe-area edges this screen is responsible for.
   *
   * `bottom` is the default and the right one for almost everything: a screen
   * inside a `Stack` has its top inset consumed by the navigation header, and
   * taking it again pushes the content down by the height of the status bar.
   * `top` is for the screens that set `headerShown: false` — welcome, the
   * splash, the scanner.
   * @default ["bottom"]
   */
  edges?: readonly ("top" | "bottom")[];
  /**
   * Centres the content in the window when it is shorter than one.
   *
   * For the screens that are a statement rather than a list — welcome, an
   * empty state that *is* the screen, a confirmation.
   */
  center?: boolean;
  /** Pull-to-refresh. Both are needed; one without the other does nothing. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /**
   * A block pinned to the bottom edge, outside the scroll.
   *
   * The primary action of a form belongs here rather than at the end of the
   * content: a seller who has filled in three fields should not have to scroll
   * to find the button that submits them.
   */
  footer?: React.ReactNode;
  /**
   * Skip the mount animation.
   *
   * For a screen that re-mounts on every keystroke — a search result, a filter
   * — where re-running the entrance reads as the screen flickering.
   */
  staticEntrance?: boolean;
  testID?: string;
};

export function Screen({
  children,
  scroll = true,
  padding = "lg",
  gap = "lg",
  edges = ["bottom"],
  center,
  onRefresh,
  refreshing,
  footer,
  staticEntrance,
  testID,
}: ScreenProps) {
  const { colors, space } = useTheme();
  const entrance = useEntrance({ disabled: staticEntrance });

  const pad = padding === "none" ? 0 : space[padding];
  const rhythm = gap === "none" ? 0 : space[gap];

  const content = (
    <Animated.View
      style={[
        {
          gap: rhythm,
          /*
           * The fill is only claimed when there is a reason to.
           *
           * A plain scrolling screen claims none: `flex: 1` here would set a
           * flex basis of zero against a container that is exactly the window's
           * height, which is to say it would cap the content at one screen and
           * stop it scrolling.
           *
           * A centred *scrolling* screen claims `flexGrow`, not `flex` — grow
           * to fill the window when the content is short, and past it when the
           * content is long. `flex: 1` would do the first and refuse the
           * second, which is the difference between a welcome screen that
           * centres on a big phone and one whose last promise is cut off on a
           * small one.
           *
           * A non-scrolling screen claims `flex: 1`, because there is nothing
           * to scroll and the fill is the whole point.
           */
          ...(scroll
            ? center
              ? { flexGrow: 1, justifyContent: "center" as const }
              : null
            : { flex: 1 }),
        },
        entrance,
      ]}
    >
      {children}
    </Animated.View>
  );

  const body = scroll ? (
    <ScrollView
      /*
       * Padding on the *content container*, never on the scroller.
       *
       * `padding` on a `ScrollView` itself insets the viewport: the scroll
       * indicator gets clipped, and the last field sits under the keyboard
       * because the inset the keyboard adds is measured against a viewport
       * that is already short.
       */
      style={{ flex: 1 }}
      contentContainerStyle={{
        padding: pad,
        /* Room past the last element for a thumb and for the home indicator.
           A list whose final row ends exactly at the bezel reads as cut off. */
        paddingBottom: pad + space["2xl"],
        ...(center ? { flexGrow: 1 } : null),
      }}
      /* iOS: let the system inset for the navigation bar and the tab bar
         rather than measuring either of them here. */
      contentInsetAdjustmentBehavior="automatic"
      /* iOS: the scroll view insets itself when the keyboard appears. Android
         has no equivalent and does not need one — the window resizes. */
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      /* Dismiss on drag: a seller scrolling a form has finished typing. */
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={Boolean(refreshing)}
            onRefresh={onRefresh}
            /* Both, because neither platform reads the other's. iOS draws
               `tintColor`; Android draws `colors` and paints the disc behind
               it with `progressBackgroundColor`, which is white by default and
               therefore invisible on a dark page. */
            tintColor={colors.contentMuted}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surface}
          />
        ) : undefined
      }
      testID={testID}
    >
      {content}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, padding: pad }} testID={testID}>
      {content}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={edges}>
      {/*
        Only wrapped when there is a footer, and that is deliberate rather than
        cautious. `KeyboardAvoidingView` measures and re-lays-out its child on
        every keyboard frame; on a plain scrolling screen iOS's
        `automaticallyAdjustKeyboardInsets` already does the job on the compositor
        and Android's `adjustResize` does it in the window manager, so wrapping
        would be a third mechanism fighting two that work. A pinned footer is
        the one case neither covers, because it lives outside the scroller.
      */}
      {footer ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {body}
          <FooterBar padding={pad}>{footer}</FooterBar>
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

/**
 * The bar the primary action sits in.
 *
 * A hairline above it and the page colour behind it, so content scrolling
 * underneath reads as going *under* the bar rather than as ending at it. It is
 * the same separation a navigation bar gets, upside down.
 */
function FooterBar({ children, padding }: { children: React.ReactNode; padding: number }) {
  const { colors, space } = useTheme();

  return (
    <View
      style={{
        paddingHorizontal: padding,
        paddingTop: space.md,
        paddingBottom: space.md,
        gap: space.sm,
        borderTopWidth: 1,
        borderTopColor: colors.borderSubtle,
        backgroundColor: colors.background,
      }}
    >
      {children}
    </View>
  );
}
