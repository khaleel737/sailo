/**
 * The design system the app is built out of.
 *
 * WHAT THIS PACKAGE IS
 *
 * Twenty components, themed for light and dark, sized off iOS's own text
 * styles, and drawn out of three layers of tokens:
 *
 *   - raw — the ink, brand and status ramps in `@sailo/tokens`, shared with the
 *     web so a green nudged in one place moves in both;
 *   - semantic — `theme/palette.ts`, which answers "what colour is a card" once
 *     per ground, with the contrast measured in `theme/palette.test.ts`;
 *   - component — `theme/components.ts`, the measurements each component is
 *     made of, including the 44pt touch target every control inherits.
 *
 * The arrangement A00 set up held: the screens were written against these prop
 * types before any of this existed, and filling the bodies in changed no screen.
 *
 * **The prop types are frozen.** The whole arrangement only works if they are:
 * a screen written against `ListRow` today must still compile when `ListRow`
 * knows how to draw itself. Adding an optional prop is fine. Renaming one,
 * changing a default, or narrowing a union is not — that is a change to a
 * contract other people have already built on, and it needs saying out loud
 * rather than doing.
 *
 * THE RULES THAT ARE ENCODED RATHER THAN WRITTEN DOWN
 *
 *   - **No `style` prop, anywhere.** Not on one of these twenty. A component
 *     that takes a style is a component whose look is decided in forty screen
 *     files, and dark mode then has to be done in all forty. Every visual
 *     decision is a named variant, and a screen that needs one that does not
 *     exist asks for it rather than reaching around.
 *   - **No `left` or `right`.** `start` and `end`, on every alignment, edge and
 *     chevron. Arabic ships; retrofitting direction means reopening every
 *     screen, and the way not to is to make the wrong thing unspellable.
 *   - **Strings are props, not children.** `Button` takes a `label`, `ListRow`
 *     takes a `title`. A component that accepts arbitrary children is one
 *     somebody eventually puts an untranslated literal inside.
 *   - **A bound admits itself.** `Chart` requires an `emptyMessage` and offers a
 *     `truncatedNote`; `Stat` has a `caption` for the window it covers. A number
 *     over a clamped query that does not say so is a number that reads as a
 *     total.
 *   - **Accessibility is in the signature.** `Progress`, `Segmented` and `Chart`
 *     require an `accessibilityLabel` because there is no text in them to read.
 *     It is a required prop rather than a review comment for the same reason
 *     `start` is not `left`.
 */

/**
 * WHAT THE APP HAS TO DO FOR THIS TO RUN
 *
 * Unistyles 3 is built on Nitro Modules, so **Expo Go no longer works** — a dev
 * client is mandatory from the commit that added this. Three things live in
 * `apps/mobile`, which this package does not own and could not change:
 *
 *   1. `babel.config.js` needs `react-native-unistyles/plugin` and
 *      `react-native-worklets/plugin`. Neither library works without its
 *      plugin, and both fail at runtime rather than at build.
 *   2. `package.json` needs `@sailo/tokens` listed, even though no screen
 *      imports it. `metro.config.js` sets `disableHierarchicalLookup`, so Metro
 *      only looks in the app's own `node_modules` and the workspace root's —
 *      and pnpm symlinks workspace packages per-package rather than at the
 *      root. A `@sailo/*` package that only this one depends on is invisible to
 *      the bundler, and the failure is at bundle time rather than at typecheck.
 *      The same applies to every workspace package added anywhere in the app's
 *      import graph. Third-party dependencies are fine — those hoist to the
 *      root, which is how the five native libraries below are reached.
 *   3. The five native modules need to be autolinked, which means the app has
 *      to declare them too: `react-native-unistyles`, `react-native-nitro-modules`,
 *      `react-native-edge-to-edge`, `react-native-reanimated` and
 *      `react-native-worklets`, plus `react-native-svg` and `expo-symbols`.
 *
 * WHERE THE RUNTIME IS STARTED
 *
 * `./theme/unistyles` is imported below for its side effect, and it is imported
 * *first*. `StyleSheet.configure` has to run before the first
 * `StyleSheet.create`, every component calls `create` at module scope, and ES
 * modules evaluate their dependencies in order — so a screen that imports
 * `Button` from this package has already configured the runtime by the time
 * `button.tsx` is evaluated. There is deliberately no `initTheme()` for a
 * screen to call and forget.
 */
import "./theme/unistyles";

export { Avatar, type AvatarProps } from "./avatar";
export { Button, type ButtonProps } from "./button";
export { Card, type CardProps } from "./card";
export { Chart, type ChartPoint, type ChartProps } from "./chart";
export { EmptyState, type EmptyStateProps } from "./empty-state";
export { ErrorState, type ErrorStateProps } from "./error-state";
export { GroupedList, type GroupedListProps } from "./grouped-list";
export { Icon, type IconProps } from "./icon";
export { ListRow, type ListRowProps } from "./list-row";
export { Money, type MoneyProps } from "./money";
export { Progress, type ProgressProps } from "./progress";
export { Segmented, type SegmentedOption, type SegmentedProps } from "./segmented";
export { Sheet, type SheetProps } from "./sheet";
export { Skeleton, type SkeletonProps } from "./skeleton";
export { Stat, type StatDelta, type StatProps } from "./stat";
export { StatusPill, type StatusPillProps } from "./status-pill";
export { Switch, type SwitchProps } from "./switch";
export { Text, type TextProps } from "./text";
export { TextField, type TextFieldAutoComplete, type TextFieldKeyboard, type TextFieldProps } from "./text-field";
export { Toast, type ToastProps } from "./toast";

export type {
  Alignment,
  Edge,
  IconName,
  Size,
  StatusTone,
  TextVariant,
  TextWeight,
  Tone,
} from "./types";
