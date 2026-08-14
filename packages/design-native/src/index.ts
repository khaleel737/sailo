/**
 * The design system the app is built out of — the API, ahead of the styling.
 *
 * WHAT THIS PACKAGE IS RIGHT NOW
 *
 * Twenty components with their final prop types and stub bodies. Every one of
 * them renders unstyled React Native primitives with the accessibility roles
 * and states already wired, and none of them has a colour, a radius or a font
 * size in it yet. That is on purpose: the screens can be written, typechecked
 * and run against these today, and the work that fills the bodies in — Unistyles
 * themes, the light and dark palettes, the motion — lands underneath them
 * without a single screen changing.
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
 * A NOTE FOR WHOEVER ADDS THE STYLING
 *
 * `@sailo/tokens` is where the ramps and scales are, and it is deliberately not
 * a dependency of this package yet: nothing here has a colour in it, and a
 * declared-but-unused dependency is one the gate has to be argued out of.
 * Add it when the bodies get filled in.
 *
 * When you do, **also add it to `apps/mobile/package.json`**, even though no
 * screen imports it. `metro.config.js` sets `disableHierarchicalLookup`, so
 * Metro only looks in the app's own `node_modules` and the workspace root's —
 * and pnpm symlinks workspace packages per-package rather than at the root. A
 * `@sailo/*` package that only this one depends on is therefore invisible to
 * the bundler, and the failure is at bundle time rather than at typecheck: this
 * package typechecked clean for a full commit before `expo export` found it.
 * The same applies to every workspace package added anywhere in the app's
 * import graph. Third-party dependencies are fine — those do hoist to the root.
 */

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
