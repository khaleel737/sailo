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
 * The palette, forwarded.
 *
 * Re-exported rather than left for each consumer to import from
 * `@sailo/tokens`, so there is one import for anything design-shaped and one
 * place to intercept it later. This is the object the styling layer builds its
 * Unistyles theme from — it is ramps and scales, not semantic roles, so a screen
 * reaching for `tokens.colors.ink[600]` is a screen that has skipped a variant
 * that should exist. Ask for the variant.
 */
export { theme as tokens, type Theme } from "@sailo/tokens";

export { Avatar, type AvatarProps } from "./avatar.tsx";
export { Button, type ButtonProps } from "./button.tsx";
export { Card, type CardProps } from "./card.tsx";
export { Chart, type ChartPoint, type ChartProps } from "./chart.tsx";
export { EmptyState, type EmptyStateProps } from "./empty-state.tsx";
export { ErrorState, type ErrorStateProps } from "./error-state.tsx";
export { GroupedList, type GroupedListProps } from "./grouped-list.tsx";
export { Icon, type IconProps } from "./icon.tsx";
export { ListRow, type ListRowProps } from "./list-row.tsx";
export { Money, type MoneyProps } from "./money.tsx";
export { Progress, type ProgressProps } from "./progress.tsx";
export { Segmented, type SegmentedOption, type SegmentedProps } from "./segmented.tsx";
export { Sheet, type SheetProps } from "./sheet.tsx";
export { Skeleton, type SkeletonProps } from "./skeleton.tsx";
export { Stat, type StatDelta, type StatProps } from "./stat.tsx";
export { StatusPill, type StatusPillProps } from "./status-pill.tsx";
export { Switch, type SwitchProps } from "./switch.tsx";
export { Text, type TextProps } from "./text.tsx";
export { TextField, type TextFieldAutoComplete, type TextFieldKeyboard, type TextFieldProps } from "./text-field.tsx";
export { Toast, type ToastProps } from "./toast.tsx";

export type {
  Alignment,
  Edge,
  IconName,
  Size,
  StatusTone,
  TextVariant,
  TextWeight,
  Tone,
} from "./types.ts";
