import { brand, ink, status } from "@sailo/tokens";

/**
 * Layer two: what each colour *means*, once per ground.
 *
 * `@sailo/tokens` answers "what is ink-600". This file answers "what colour is
 * a card", and it answers it twice — because that is the only honest way to
 * write it down. Dark mode is not an inversion. Walking the ramp backwards
 * gives you a card that is lighter than the sheet floating above it, a green
 * that goes muddy, and a muted grey that disappears; every value below was
 * picked for its own ground and then measured against it. `palette.test.ts`
 * holds those measurements, so a nudge that breaks one is a red test rather
 * than a screen somebody eventually squints at.
 *
 * Roles, never values. Nothing downstream of here says `ink[700]`: a component
 * asks for `border` or `contentMuted` and the ground it is on decides. That is
 * what makes the dark palette a change to this file rather than to twenty
 * components, and it is why there is no escape hatch back to the raw ramps in
 * the component token layer.
 *
 * The light values are the web's, deliberately. `apps/web/src/app/globals.css`
 * declares `--surface-*` for exactly this job, and a seller who does half their
 * day in the admin and half on the phone should not be able to tell that two
 * teams picked the greys.
 */
export type Palette = {
  /** The page itself. Everything else sits on this. */
  background: string;
  /** A card, or a grouped list section — the thing content is actually on. */
  surface: string;
  /** Above the page: sheets, toasts, anything with a shadow under it. */
  surfaceElevated: string;
  /** Below it: a field's fill, a progress track, an unselected segment. */
  surfaceSunken: string;
  /** Behind a sheet. The one colour here that is deliberately translucent. */
  scrim: string;

  /** Ordinary text. */
  content: string;
  /** Present but secondary — captions, hints, timestamps, placeholders. */
  contentMuted: string;
  /** Disabled. Exempt from the contrast floor because it is not readable *on purpose*. */
  contentSubtle: string;
  /** On a filled dark surface in light mode, and vice versa. */
  contentInverse: string;

  /** The brand green, at the step that works on this ground. */
  accent: string;
  /** The same green, held down. */
  accentPressed: string;
  /** A green wash — a selected segment, a brand-tinted row. */
  accentSubtle: string;
  /** Text and icons on an `accent` fill. */
  accentContent: string;
  /**
   * The focus ring.
   *
   * A step off the accent on each ground rather than the same green, and drawn
   * *outside* the control with a gap of page behind it — the web's `focus-ring`
   * does the same with `outline-offset: 2px`. Both halves matter: the gap is
   * what separates the ring from the button it is ringing, and the step is what
   * stops a ring round an accent-filled button reading as a thicker button.
   *
   * The web's ring is `brand-500`, which measures 2.5:1 on white. That is under
   * the 3:1 that 1.4.11 asks of a control affordance, so this is not that value
   * — see `palette.test.ts`.
   */
  focus: string;

  /** Hairlines, card edges, separators. */
  border: string;
  /**
   * A border that has to be *found* rather than merely respected — a field's
   * edge, a segmented control's track. `border` is a hairline between things
   * you already know are there; this one is the only thing saying a control
   * exists, so it carries the 3:1 that 1.4.11 asks for.
   */
  borderStrong: string;

  /** Something went wrong. Text and icons, not a fill. */
  danger: string;
  /** A destructive fill. */
  dangerSurface: string;
  /** Text and icons on `dangerSurface`. */
  dangerContent: string;
  /** It worked. */
  success: string;
  /** Worth reading, but not an error. */
  warning: string;
  /** Neutral information — the one place a blue carries meaning. */
  info: string;

  /**
   * The five badge grounds, as a fill and the text that goes on it.
   *
   * Keyed by `StatusTone` so a pill cannot be given a colour that has no text
   * colour to go with it. The light pairs are the web's badge palette
   * (`apps/web/src/components/ui/feedback.tsx`) step for step; the dark ones
   * are chosen against the dark card, because the web has no dark badge to
   * copy and 950-on-card is a badge you cannot see the edges of.
   */
  statusTone: Record<
    "neutral" | "info" | "success" | "warning" | "danger",
    { background: string; content: string }
  >;

  /** The bar a `Skeleton` draws, and the band that sweeps across it. */
  skeleton: string;
  skeletonSheen: string;
};

/**
 * Light.
 *
 * The page is `ink-50` rather than white, and the card is white — the opposite
 * way round from the web, on purpose. Nearly every screen in this app is a
 * grouped list, and a white list on a white page has nothing to separate the
 * sections but hairlines. iOS solves it by sinking the page; so do we.
 */
export const lightPalette: Palette = {
  background: ink[50],
  surface: "#ffffff",
  surfaceElevated: "#ffffff",
  surfaceSunken: ink[100],
  scrim: "rgba(13, 13, 12, 0.32)",

  content: ink[900],
  contentMuted: ink[500],
  contentSubtle: ink[400],
  contentInverse: "#ffffff",

  accent: brand[700],
  accentPressed: brand[800],
  accentSubtle: brand[50],
  accentContent: "#ffffff",
  focus: brand[600],

  /* The web's `--surface-border`. Between ink-100 and ink-200, and neither. */
  border: "#e6e3dc",
  borderStrong: ink[500],

  danger: status.red[700],
  dangerSurface: status.red[700],
  dangerContent: "#ffffff",
  success: status.emerald[700],
  /*
   * 800 where the other three hues sit at 700. Amber is the lightest of them
   * at any given step, and `amber-700` measures 4.37:1 on `surfaceSunken` —
   * under the floor, and only there, which is exactly the kind of near-miss
   * that ships when the ramps are chosen by symmetry instead of by measurement.
   * The web's amber badge is a step darker than its siblings for the same
   * reason.
   */
  warning: status.amber[800],
  info: status.blue[700],

  statusTone: {
    neutral: { background: ink[100], content: ink[700] },
    info: { background: status.blue[100], content: status.blue[800] },
    success: { background: status.emerald[100], content: status.emerald[800] },
    warning: { background: status.amber[100], content: status.amber[900] },
    danger: { background: status.red[100], content: status.red[700] },
  },

  skeleton: ink[100],
  skeletonSheen: ink[50],
};

/**
 * Dark.
 *
 * The three surface values are the web's `[data-surface="dark"]` set, which
 * are deliberately off-ramp: a card at `ink-900` on a page at `ink-950` is a
 * two-step difference nobody can see, so the web hand-picked the intermediate
 * greys and this reuses them rather than rounding to the nearest token.
 *
 * The green lifts from `brand-700` to `brand-400`. `brand-700` is 1.6:1 on the
 * dark card — legible as a shape and not as a word — and the button that used
 * it would read as disabled. Lifting means the text *on* an accent fill flips
 * from white to near-black, which is the part that gets forgotten.
 */
export const darkPalette: Palette = {
  background: ink[950],
  surface: "#171614",
  surfaceElevated: "#1f1e1a",
  surfaceSunken: ink[950],
  scrim: "rgba(0, 0, 0, 0.6)",

  content: "#f4f3f0",
  contentMuted: "#9d9990",
  contentSubtle: ink[600],
  contentInverse: ink[950],

  accent: brand[400],
  accentPressed: brand[300],
  accentSubtle: brand[950],
  accentContent: ink[950],
  focus: brand[300],

  border: "#2b2924",
  /*
   * The same step as light, which is the one place the two palettes agree on a
   * value rather than on a role. Mid-ramp is the only region far enough from
   * both ends to clear 3:1 on a near-black card and on near-white paper.
   */
  borderStrong: ink[500],

  danger: status.red[400],
  dangerSurface: status.red[400],
  dangerContent: ink[950],
  success: status.emerald[400],
  warning: status.amber[400],
  info: status.blue[400],

  statusTone: {
    neutral: { background: ink[800], content: ink[200] },
    info: { background: status.blue[900], content: status.blue[200] },
    success: { background: status.emerald[900], content: status.emerald[200] },
    warning: { background: status.amber[900], content: status.amber[200] },
    danger: { background: status.red[900], content: status.red[200] },
  },

  skeleton: ink[800],
  skeletonSheen: ink[700],
};
