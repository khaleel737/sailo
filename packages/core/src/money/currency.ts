/**
 * Money: the currency table, and the two directions between a number and a
 * person reading it.
 *
 * WHY THIS FILE IS NOW AN ENTRY AND NOT AN IMPLEMENTATION
 *
 * It was 557 lines holding four unrelated jobs — the table of currencies, the
 * render direction, the parse direction, and (arriving by accident) a file-size
 * formatter. A hundred and five files import `@sailo/core/currency`, so the
 * subpath is worth keeping stable; what it points at is not worth keeping in one
 * file.
 *
 *   ./codes    which currencies exist and how many minor units each has
 *   ./format   minor units → text          (formatMoney, currencyLabel, priceToText)
 *   ./parse    text → minor units          (moneyToCents, textToPrice, textToCount)
 *
 * `./codes` is the single answer to "how many decimal places", asked by both
 * directions. That is the invariant that matters: when render divided by a flat
 * 100 and parse consulted the table, a seller opened a ¥1,000 product, pressed
 * Save without touching it, and sold it for ¥10.
 *
 * `formatBytes` and `formatDuration` left entirely — they are in
 * `@sailo/core/format`, because a download listing has no currency in it.
 */

export * from "./codes";
export * from "./format";
export * from "./parse";
