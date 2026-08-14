/**
 * The vocabulary every component in this package shares.
 *
 * Kept in one file because these unions are the actual contract. A screen that
 * says `tone="danger"` on a pill and `tone="danger"` on a button must mean the
 * same red in both places, and the way to guarantee that is for both to be
 * spelling the same union rather than two hand-written lists that agree today.
 *
 * Everything here is a *role*, never a value. There is no `"red"` and no
 * `"#dc2626"`: a screen says what a thing means and the theme decides what that
 * looks like, which is what makes dark mode and a later palette change a change
 * to one package rather than to forty screens.
 */

/** What a piece of the interface means, semantically. */
export type Tone =
  /** Ordinary content. The default everywhere. */
  | "default"
  /** Present but secondary — captions, hints, timestamps. */
  | "muted"
  /** The brand green. Reserve it for what is interactive or on-brand. */
  | "brand"
  /** Something went wrong, or is about to. */
  | "danger"
  /** It worked. */
  | "success"
  /** Worth reading before continuing, but not an error. */
  | "warning"
  /** On top of a filled surface — a primary button, a dark banner. */
  | "inverse";

/**
 * The narrower set a status badge can be.
 *
 * Separate from `Tone` on purpose: a badge has no "muted" or "inverse", and
 * offering them would let a screen render a status nobody can read. `"info"`
 * exists here and not in `Tone` because a badge is the one place a neutral blue
 * carries meaning rather than decoration.
 */
export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

/** The three sizes anything with a size comes in. */
export type Size = "sm" | "md" | "lg";

/**
 * Where something sits along the writing direction.
 *
 * `start`/`end`, never `left`/`right`. Arabic is a shipped language, and a
 * component API that offers `left` is one that has to be reopened screen by
 * screen the day somebody notices. There is deliberately no `"left"` to pass.
 */
export type Alignment = "start" | "center" | "end";

/** Which end of a row a decoration hangs off. */
export type Edge = "start" | "end";

/**
 * The type scale.
 *
 * Named for the job rather than the size, so a screen asks for a `title` and
 * gets whatever a title is on this platform at this Dynamic Type setting —
 * which is the whole reason not to let screens pass a font size.
 */
export type TextVariant =
  /** The one big number or name a screen opens with. */
  | "display"
  /** A screen's own title, where the navigation bar isn't carrying it. */
  | "title"
  /** A section heading inside a screen. */
  | "heading"
  /** Ordinary running text. The default. */
  | "body"
  /** Body, one step down — supporting lines under a title. */
  | "callout"
  /** The small print: hints, timestamps, footnotes. */
  | "caption"
  /** The all-caps group label above a list section. */
  | "label";

/** Weight, as four names rather than a number nobody remembers the mapping of. */
export type TextWeight = "regular" | "medium" | "semibold" | "bold";

/**
 * Every icon the product may draw, as a role.
 *
 * A closed union rather than a `string`, because the alternative is a screen
 * naming an SF Symbol directly — which then has to be re-picked for Android,
 * and which puts a platform detail in a screen file. A01 maps each of these to
 * a symbol per platform; a screen that needs a new one asks for it to be added
 * here rather than reaching past the package.
 *
 * `chevronEnd` and not `chevronRight`: it points *forward*, and forward is
 * leftward in Arabic.
 */
export type IconName =
  // Navigation and structure
  | "home"
  | "orders"
  | "store"
  | "insights"
  | "settings"
  | "chevronEnd"
  | "chevronDown"
  | "close"
  | "back"
  | "external"
  // Actions
  | "add"
  | "edit"
  | "delete"
  | "search"
  | "filter"
  | "share"
  | "copy"
  | "refresh"
  | "scan"
  // Objects
  | "camera"
  | "photo"
  | "link"
  | "card"
  | "bank"
  | "cash"
  | "calendar"
  | "clock"
  | "person"
  | "bell"
  | "ticket"
  | "tag"
  // Feedback
  | "check"
  | "warning"
  | "info"
  | "error";
