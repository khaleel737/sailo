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
 * WHERE THE COLOURS COME FROM
 *
 * `../tokens` — the ramps and scales, one folder up, shared with the web half
 * of this package and with the Tailwind `@theme` partial generated from them.
 * They used to be `@sailo/tokens`, a package of their own, which meant the
 * phone's green and the browser's green were one edit away from parting
 * company only for as long as somebody remembered to regenerate. Now they are
 * one folder in one package, and `src/tokens/tokens.test.ts` fails if the
 * generated CSS and this source disagree.
 *
 * A WARNING THAT OUTLIVED THAT MOVE
 *
 * A `@sailo/*` package reached only from here is invisible to Metro.
 * `metro.config.js` sets `disableHierarchicalLookup`, so Metro looks only in
 * the app's own `node_modules` and the workspace root's — and pnpm links
 * workspace packages per-package rather than at the root. The failure is at
 * bundle time rather than at typecheck: this package typechecked clean for a
 * full commit before `expo export` found it. So a new `@sailo/*` dependency
 * added here **also goes in `apps/mobile/package.json`**, even when no screen
 * imports it directly. Third-party dependencies are fine — those hoist.
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
 * series unspellable. `Series` from `@sailo/design-system/chart` is what replaces it,
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
/**
 * The floating tab bar, declared once by the app so that `Screen` can leave
 * room for it — in its scroll extent and, more importantly, under a pinned
 * footer.
 */
export { BottomChrome, TAB_BAR_HEIGHT, useBottomChrome } from "./bottom-chrome";
export { Screen, type ScreenProps } from "./screen";
export { SearchField, type SearchFieldProps } from "./search-field";
export { Section, type SectionProps } from "./section";
export { Segmented, type SegmentedOption, type SegmentedProps } from "./segmented";
export { Sheet, type SheetProps } from "./sheet";
export { Skeleton, type SkeletonProps } from "./skeleton";
export { BrandSplash, type BrandSplashProps, MARK_RATIO } from "./splash";
export { Stat, type StatDelta, type StatProps } from "./stat";
export { StatRow, type StatRowProps } from "./stat-row";
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
 * How much room there is.
 *
 * The one hook a screen genuinely has to be able to ask, because the answer
 * changes what it *renders* rather than how it looks — two columns or three, a
 * detail beside a list or behind a push. `Screen`, `StatRow` and `GroupedList`
 * consume it on a screen's behalf for the cases that are only about looks;
 * this is for the ones that are not.
 */
export { useLayout, type Layout } from "./layout";

/**
 * The motion a list is allowed to have.
 *
 * Exported, unlike the hooks in `./motion`, because these are *declarations a
 * screen hands to a row* rather than animations a component runs on its own —
 * `entering={rowEntering(index)}` on a `FlashList` item, `layout={rowLayout}`
 * on a group whose contents change. There is no component that could apply them
 * on the screen's behalf, because only the screen knows the index.
 */
export { rowEntering, rowLayout, blockEntering, stagger } from "./list-motion";

/**
 * The theme itself, for the handful of places a component cannot reach.
 *
 * Screens should not need this — the whole point of the primitives is that a
 * screen never picks a colour. The exception is a native container the package
 * does not own: `NativeTabs` takes a `tintColor` prop and there is no Sailo
 * component wrapping it, so the layout has to read the accent to hand over.
 */
export { useTheme, type Theme, type Palette } from "./theme";
