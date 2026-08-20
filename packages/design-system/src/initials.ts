/**
 * The first letters of up to two words — "Clay & Co." → "CC".
 *
 * Up to two *leading* words, not first-and-last: three copies of this had
 * grown, and the native one took first+last, so "Forno Rossi Bakery" was FB
 * on the phone and FR on the web — the same shop wearing two monograms.
 * Symbols are stripped so "&" never becomes an initial, and the first letter
 * is taken by code point so an emoji in a shop name is not torn in half.
 */
export function initials(name: string, fallback = ""): string {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => ([...word][0] ?? "").toUpperCase())
      .join("") || fallback
  );
}
