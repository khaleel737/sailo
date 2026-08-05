/**
 * The colours every chart in the product draws with.
 *
 * WHY THIS FILE EXISTS
 * There were four hex values scattered across five call sites in /admin and
 * /hq, assigned by whoever wrote each one. The same measure came out indigo on
 * one screen and teal on another, and an indigo traffic chart sat beside a teal
 * money chart in the same card row, which reads as decoration rather than as
 * meaning. Colour has to follow the entity, never the call site and never the
 * order the charts happen to appear in.
 *
 * WHY THERE ARE ONLY TWO
 * Not for lack of trying. Every candidate was measured against the six checks
 * (lightness band, chroma floor, CVD separation, normal-vision floor, contrast)
 * on both the light app surface and the dark one, across all pairs rather than
 * only adjacent ones. Green is fixed: it is the mark, and money is the headline
 * measure. Against it:
 *
 *   blue    ΔE 23.2 deuteranopia   PASS
 *   violet  ΔE  9.9               weak
 *   amber   ΔE  5.1 protanopia     FAIL
 *   rose    ΔE  4.0 deuteranopia   FAIL
 *   teal    ΔE  1.7 tritanopia     FAIL
 *
 * Nothing warm survives beside green, because that is the red-green axis. The
 * only two cool hues that clear green then fail against each other: blue and
 * violet sit at ΔE 4.7 deuteranopia and 14.6 in normal vision, under the hard
 * floor. Two hues nobody can tell apart are worse than one hue used twice.
 *
 * So a third categorical hue is not available, and a fourth certainly is not.
 * Rather than ship a palette that fails for roughly one man in twelve, the
 * encoding carries the distinction that a commerce dashboard actually turns on:
 * is this money, or is this activity. Both charts of the same class share a
 * hue and are told apart by their title, their total and their position, which
 * is where identity should live anyway.
 *
 * THE SECONDARY ENCODING
 * No chart here is identified by colour alone. Every one carries a title naming
 * the measure, a hero total, a direct label on the peak, and a table view behind
 * a disclosure. Colour is the at-a-glance cue for which card you are looking at,
 * never the only cue.
 *
 * IF A THIRD IS EVER NEEDED
 * Do not reach for a new hue; the space is genuinely full. Facet instead (small
 * multiples of the same hue), or step the existing hue in lightness, which is
 * the one axis that survives every kind of colour blindness.
 */

export const CHART = {
  /** Anything denominated in a currency: revenue, GMV, seller volume, payouts. */
  money: "#037740",
  /** Anything counted: visits, orders, registrations, sessions. */
  activity: "#0B63CE",
} as const;

export type ChartTone = keyof typeof CHART;
