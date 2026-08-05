/**
 * X reads `twitter:image`. It falls back to `og:image` by convention rather
 * than by contract, so the tag is emitted explicitly and points at the same
 * drawing.
 *
 * The config below is repeated rather than re-exported: Next parses these
 * fields statically, and neither a re-export nor an imported constant is
 * visible to that parser.
 */
export { default } from "./opengraph-image";

export const alt = "Sailo";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 3600;
