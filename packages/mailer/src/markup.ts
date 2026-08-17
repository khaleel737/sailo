/**
 * The HTML an email is built from.
 *
 * Email clients are the one rendering target that never updates: no external
 * CSS, no flexbox in Outlook, no SVG in Gmail. Everything here is therefore
 * tables, inline styles and hosted PNGs — the 1999 toolkit, used on purpose.
 *
 * Every value that reaches the markup goes through `esc` first. An order
 * carries text the buyer typed — their name, their note — and a shop carries
 * text its owner typed, so both are someone else's input by the time they
 * arrive here. Helpers that accept `html` parameters expect the caller to have
 * escaped every interpolated value already; helpers that accept plain strings
 * escape them themselves. Each one says which it is.
 *
 * WHY THIS IS AN ENTRY AND NOT AN IMPLEMENTATION
 *
 * 520 lines holding four different kinds of thing: an escaping function with a security
 * property, a palette of design decisions, two page skeletons, and the blocks a message is
 * built from. The palette in particular needed to be somewhere a reader would not tidy it:
 * its one deliberate deviation from the app's colours is a contrast-ratio floor, and that
 * reason is easy to lose in a file this long.
 *
 *   ./escape   what every value passes through before it reaches an inbox
 *   ./palette  the inks, and the one substitution email needs
 *   ./layout   the two skeletons, by who sent the mail
 *   ./blocks   paragraphs, sections, rows, buttons
 */

export * from "./escape";
export * from "./layout";
export * from "./blocks";

/*
 * `./palette` is deliberately not re-exported. Those constants were private to the
 * 520-line file and only became exported so `./layout` and `./blocks` could reach them —
 * publishing them from here would turn an internal detail into part of the package's
 * surface, and an ink somebody outside can depend on is an ink nobody can change.
 */
