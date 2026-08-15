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
export { Banner, type BannerProps } from "./banner";
export { BrandMark, type BrandMarkProps, Wordmark, type WordmarkProps } from "./brand";
export { Button, type ButtonProps } from "./button";
export { Card, type CardProps } from "./card";
/*
 * `Chart`'s props changed shape, which the rules above say has to be said out
 * loud rather than done. It is said in `./chart/index.tsx`: the component could
 * only ever hold one measure, so the phone drew net revenue as a bare line
 * while the web drew sales, refunds below the axis and net in the readout. The
 * new signature is `apps/web`'s, prop for prop.
 *
 * `ChartPoint` is gone with it — a flat label/value pair is what made a second
 * series unspellable. `Series` from `@sailo/core/chart` is what replaces it,
 * and it is the same type the web builds its cards from.
 */
export { Chart, type ChartProps } from "./chart";
export { Chip, type ChipProps } from "./chip";
export { CodeField, type CodeFieldProps } from "./code-field";
export { Divider, type DividerProps } from "./divider";
export { EmptyState, type EmptyStateProps } from "./empty-state";
export { ErrorState, type ErrorStateProps } from "./error-state";
export { GroupedList, type GroupedListProps } from "./grouped-list";
export { Icon, type IconProps } from "./icon";
export { IconButton, type IconButtonProps } from "./icon-button";
export { ListRow, type ListRowProps } from "./list-row";
export { Money, type MoneyProps } from "./money";
export { Progress, type ProgressProps } from "./progress";
export { Screen, type ScreenProps } from "./screen";
export { Segmented, type SegmentedOption, type SegmentedProps } from "./segmented";
export { Sheet, type SheetProps } from "./sheet";
export { Skeleton, type SkeletonProps } from "./skeleton";
export { BrandSplash, type BrandSplashProps, MARK_RATIO } from "./splash";
export { Stat, type StatDelta, type StatProps } from "./stat";
export { StatusPill, type StatusPillProps } from "./status-pill";
export { StepDots, type StepDotsProps } from "./step-dots";
export { Switch, type SwitchProps } from "./switch";
export { Text, type TextProps } from "./text";
export { TextField, type TextFieldAutoComplete, type TextFieldKeyboard, type TextFieldProps } from "./text-field";
export { Toast, type ToastProps } from "./toast";

export type {
  Alignment,
  Edge,
  IconName,
  Size,
  Space,
  StatusTone,
  TextVariant,
  TextWeight,
  Tone,
} from "./types";

/**
 * The two things a screen is allowed to reach past a component for.
 *
 * `haptics` because feedback is a *product* decision rather than a component
 * one: the primitives buzz on their own presses, but only the screen knows
 * that a scan matched, that a payout landed, or that the code the seller just
 * typed was the wrong one. `useReducedMotion` for the same reason in reverse —
 * a screen composing its own animation has to honour the setting the
 * primitives already honour, and the alternative is each screen reimplementing
 * the `AccessibilityInfo` subscription.
 *
 * Everything else in `./motion` is deliberately not exported. A screen that
 * needs an entrance gets one from `Screen`; a screen that needs a press scale
 * gets one from the control it is pressing. Exporting the hooks would make
 * "write your own animation" as easy as "use the one the system has", and the
 * whole reason the app looks like one app is that it is not.
 */
export { haptics, type Haptic } from "./haptics";
export { useReducedMotion } from "./motion";

/**
 * The theme itself, for the handful of places a component cannot reach.
 *
 * Screens should not need this — the whole point of the primitives is that a
 * screen never picks a colour. The exception is a native container the package
 * does not own: `NativeTabs` takes a `tintColor` prop and there is no Sailo
 * component wrapping it, so the layout has to read the accent to hand over.
 */
export { useTheme, type Theme, type Palette } from "./theme";
