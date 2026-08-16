import { Animated, Platform, RefreshControl, ScrollView, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { useContext } from "react";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { useBottomChrome } from "./bottom-chrome";
import { useKeyboardLift } from "./keyboard";
import { useLayout } from "./layout";
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
  const lift = useKeyboardLift();
  const { gutter, maxWidth } = useLayout();
  /* What is already covering the bottom of the window — the floating tab bar,
     or nothing. `bottom-chrome.tsx` says why `Screen` cannot work this out. */
  const chrome = useBottomChrome();
  /*
   * The insets applied as *padding on the content*, not by a `SafeAreaView`
   * wrapper — and that swap is the fix for three separate bugs.
   *
   * iOS gives a scroll view its content inset automatically when it can see one:
   * that is what draws a large title, what leaves room for a translucent tab
   * bar, and what keeps the last row of a list off the home indicator.
   * `contentInsetAdjustmentBehavior="automatic"` asks for it. But the lookup
   * walks the *native* view hierarchy for the scroll view a screen owns, and a
   * `SafeAreaView` between the screen and the scroller was enough to lose it.
   * The symptoms were the large title reserving space and drawing nothing, the
   * search field on Orders sitting underneath a title that was drawn over it,
   * and content running under the floating tab bar.
   *
   * So the scroller is the screen's own child now, and the safe area is
   * arithmetic on the content container. It is also more correct: a wrapper
   * insets the *viewport*, so a list scrolls to a stop above the home indicator
   * instead of passing under it.
   */
  /* The context rather than `useSafeAreaInsets()`, which throws outright when
     no provider is mounted above it — see the same note in `keyboard.ts`. A
     screen rendered in a test, or outside the navigator, should lay out without
     insets rather than take its subtree down. */
  const insets = useContext(SafeAreaInsetsContext);
  const top = edges.includes("top") ? (insets?.top ?? 0) : 0;
  const bottom = edges.includes("bottom") ? (insets?.bottom ?? 0) : 0;

  /*
   * The side margin comes from the window, not from a constant.
   *
   * `padding="lg"` used to mean a flat 16pt everywhere — the same margin on a
   * 320pt SE, where it is most of the remaining room, and on a 430pt Pro Max,
   * where the content ends up further from the bezel than the type is tall.
   * `useLayout` derives it. A caller that names a step explicitly still gets
   * that step; the default is the one that adapts, because the default is what
   * forty screens use.
   */
  const pad = padding === "none" ? 0 : padding === "lg" ? gutter : space[padding];
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
        paddingTop: pad + top,
        /*
         * Room past the last element, and the number is larger than it looks
         * like it should be.
         *
         * iOS 26 draws the tab bar as a floating capsule *over* the content —
         * that is the idiom, and content is supposed to pass under it. What
         * `contentInsetAdjustmentBehavior` does not reliably contribute is the
         * matching *scroll extent*, so the last row of every tab screen came to
         * rest underneath the bar with no way to scroll it clear. Measured on a
         * 852pt window the capsule occupies about 72 points including its
         * margin; this clears it, plus a thumb's worth.
         *
         * On a screen that is not in a tab it is simply extra room at the end
         * of a scroll, which costs nothing — it is below the last element and
         * invisible unless somebody scrolls past everything.
         */
        paddingBottom: pad + bottom + chrome + space["2xl"],
        ...(center ? { flexGrow: 1 } : null),
        /*
         * The readable column, centred, once the window is wider than one.
         *
         * ~620pt is roughly 70 characters at the body size — the measure past
         * which the eye loses the line it was on during the return sweep. It
         * only ever engages on a tablet, in landscape, or in a Stage Manager
         * window; on every phone in portrait `maxWidth` is `undefined` and this
         * is two properties that do nothing.
         */
        ...(maxWidth ? { maxWidth, width: "100%" as const, alignSelf: "center" as const } : null),
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
    <View
      style={{
        flex: 1,
        padding: pad,
        paddingTop: pad + top,
        paddingBottom: pad + bottom,
        ...(maxWidth ? { maxWidth, width: "100%" as const, alignSelf: "center" as const } : null),
      }}
      testID={testID}
    >
      {content}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {body}
      {/*
        The footer rides the keyboard rather than reacting to it.

        This was a `KeyboardAvoidingView` with `behavior="padding"` and no
        `keyboardVerticalOffset`, which is wrong by the height of the navigation
        bar on every screen in a stack — the view measures from the top of the
        window, the content starts below the header, and the difference is 44 to
        96 points of dead page shoved under the form. It was also a frame or two
        late, because it responds to `keyboardWillShow` and then runs *its own*
        animation to catch up with one the system is already running.

        `useKeyboardLift` reads the keyboard's live height on the UI thread and
        translates by it, so there is no duration to pick and no curve to match.
        `keyboard.ts` carries the rest.

        The scroller keeps its own inset handling — `automaticallyAdjustKeyboardInsets`
        on iOS, the window resize on Android — because those move the *content*,
        which is a different job from moving the bar.
      */}
      {footer ? (
        <Reanimated.View style={lift}>
          <FooterBar padding={pad} bottom={bottom + chrome} maxWidth={maxWidth}>
            {footer}
          </FooterBar>
        </Reanimated.View>
      ) : null}
    </View>
  );
}

/**
 * The bar the primary action sits in.
 *
 * A hairline above it and the page colour behind it, so content scrolling
 * underneath reads as going *under* the bar rather than as ending at it. It is
 * the same separation a navigation bar gets, upside down.
 */
function FooterBar({
  children,
  padding,
  bottom,
  maxWidth,
}: {
  children: React.ReactNode;
  padding: number;
  /**
   * What the bar has to clear below it — the home-indicator inset, plus any
   * floating chrome. Without the second half the footer draws *underneath* the
   * tab bar, which is where nine screens' Save buttons were.
   */
  bottom: number;
  /**
   * The readable column the content above is using, when there is one.
   *
   * The *bar* ignores it and the *buttons inside it* do not, which is the
   * whole point — see below.
   */
  maxWidth: number | undefined;
}) {
  const { colors, space } = useTheme();

  return (
    <View
      style={{
        paddingHorizontal: padding,
        paddingTop: space.md,
        paddingBottom: space.md + bottom,
        borderTopWidth: 1,
        borderTopColor: colors.borderSubtle,
        backgroundColor: colors.background,
      }}
    >
      {/*
        The bar spans the window; what sits in it does not.

        `Screen` caps its content at a readable column and centres it once the
        window is wider than one. The footer used to be outside that entirely —
        it is a sibling of the scroller, not a child — so on a tablet fifteen
        screens drew a 620pt column of form fields above a Save button stretched
        across the full 1366pt of the window, ending nowhere near the fields it
        saves.

        Capping the bar itself would fix the alignment and break something else:
        a toolbar is chrome, and chrome that stops short of the window edges
        reads as a floating card with a hairline on top of it. Both platforms
        span the bar and lay its contents out in the readable width, so that is
        what this does — the separator still runs edge to edge, and the button
        lines up with the last field above it.

        `gap` moved in here with the children, because it belongs to the row of
        actions rather than to the bar.
      */}
      <View
        style={{
          gap: space.sm,
          ...(maxWidth
            ? { maxWidth, width: "100%" as const, alignSelf: "center" as const }
            : null),
        }}
      >
        {children}
      </View>
    </View>
  );
}
