import { radius, space } from "@sailo/tokens";

/**
 * Layer three: the measurements each component is made of.
 *
 * Sizes, not colours. A button's green comes from the palette and changes with
 * the ground; its height does not. Keeping the two apart is what stops the
 * component files growing a second opinion about how tall a row is — and it is
 * why `listRow.minHeight` is one number here rather than a `44` typed into four
 * files, three of which get updated when it changes.
 *
 * THE 44 THAT APPEARS EVERYWHERE
 *
 * Apple's minimum touch target and the same intent as the web's
 * `pointer-coarse:min-h-11`. It is enforced here, in the primitives, because a
 * rule a screen has to remember is a rule that holds for as long as the person
 * who wrote it is still reading the diffs. Anything smaller than 44 on screen —
 * a `sm` button, a bare icon — gets the difference back as `hitSlop`, so the
 * drawing and the target are allowed to disagree and only the drawing shrinks.
 *
 * Everything is `minHeight`, never `height`. See `typography.ts`: nothing caps
 * Dynamic Type, so every one of these has to be free to grow.
 */

/** Apple's minimum, in points. The number the rest of this file defers to. */
export const MIN_TARGET = 44;

/**
 * The slop that brings a control of `height` up to `MIN_TARGET`.
 *
 * Symmetrical, and zero when the control is already big enough — React Native
 * happily accepts a negative `hitSlop` and shrinks the target, which is the
 * opposite of the point.
 */
export function slopTo(height: number): number {
  return Math.max(0, (MIN_TARGET - height) / 2);
}

export const components = {
  button: {
    /** Visual height. `sm` is under the minimum on purpose — `slopTo` covers it. */
    height: { sm: 36, md: MIN_TARGET, lg: 52 },
    paddingInline: { sm: space.md, md: space.lg, lg: space.xl },
    /** Space between an icon and its label. */
    gap: space.sm,
    /** The control radius, shared with fields and chips. */
    radius: radius.xl,
    /** How far a press takes it down. */
    pressScale: 0.97,
    /** What a disabled control fades to. */
    disabledOpacity: 0.4,
    /** Drawn outside the control, with this much page showing between. */
    focusWidth: 2,
    focusOffset: 2,
  },

  card: {
    /** The surface radius. Bigger than a control's, so a card reads as ground. */
    radius: radius["2xl"],
    padding: { none: space.none, sm: space.md, md: space.lg, lg: space.xl },
    /**
     * The shadow under `elevated`. iOS reads `shadow*`, Android reads
     * `elevation`, and both are set because setting one gives you a card that
     * floats on exactly one platform.
     */
    elevation: {
      shadowOpacity: 0.12,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      androidElevation: 4,
    },
  },

  listRow: {
    minHeight: MIN_TARGET + space.sm,
    paddingInline: space.lg,
    paddingBlock: space.md,
    /** Between the icon, the text column and whatever trails it. */
    gap: space.md,
    /**
     * The hairline starts after the leading padding, so the separators line up
     * under the text rather than running edge to edge. iOS's grouped lists do
     * this; it is what makes a list read as rows of one thing.
     */
    separatorInset: space.lg,
  },

  field: {
    minHeight: MIN_TARGET,
    /** A note or a description. Still grows past this. */
    multilineMinHeight: 96,
    paddingInline: space.md,
    paddingBlock: space.sm,
    radius: radius.xl,
    borderWidth: 1,
    /** The error and focus states thicken it rather than only recolouring it. */
    focusBorderWidth: 2,
    gap: space.xs,
  },

  pill: {
    paddingInline: { sm: space.sm, md: space.md },
    paddingBlock: { sm: 2, md: space.xs },
    /** A capsule. Anything this small reads as a tag rather than a button. */
    radius: 999,
  },

  sheet: {
    radius: radius["3xl"],
    /** The grab handle above the content. */
    handleWidth: 36,
    handleHeight: 5,
    paddingInline: space.lg,
    paddingBlock: space.lg,
    /** `medium` and `large` as a share of the screen; `auto` hugs its content. */
    heightFraction: { medium: 0.5, large: 0.92 },
  },

  toast: {
    radius: radius.xl,
    paddingInline: space.lg,
    paddingBlock: space.md,
    /** How long it waits before calling `onDismiss` itself, in milliseconds. */
    dwell: { short: 3200, long: 6000 },
  },

  avatar: {
    size: { sm: 28, md: 36, lg: 48, xl: 72 },
    /** A shop is a rounded rectangle; the radius scales with the box. */
    roundedRadius: { sm: 8, md: 10, lg: radius.lg, xl: radius.xl },
  },

  icon: {
    /** Points. `md` matches the 17pt body text it usually sits beside. */
    size: { sm: 16, md: 20, lg: 24 },
  },

  progress: {
    track: { sm: 4, md: 8 },
    radius: 999,
  },

  segmented: {
    minHeight: MIN_TARGET,
    /** The gap between the track and the selected segment inside it. */
    inset: 2,
    radius: radius.xl,
  },

  chart: {
    height: { sm: 96, md: 148, lg: 220 },
    /** Room at the bottom for the axis labels. */
    axisHeight: 18,
    lineWidth: 2,
    /** The dot on the last reading. */
    endpointRadius: 3.5,
    /** How far the area under the line fades out. */
    areaOpacity: 0.14,
    gridWidth: 1,
    /** A bar chart's bars, as a share of the slot each one gets. */
    barFill: 0.62,
  },

  skeleton: {
    /** The shapes, as the proportions of the thing each stands in for. */
    text: { height: 13, width: "78%" },
    title: { height: 22, width: "56%" },
    row: { height: MIN_TARGET + space.sm },
    card: { height: 116 },
    circle: { size: 36 },
    radius: radius.lg,
    gap: space.sm,
  },
} as const;
