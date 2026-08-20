/**
 * Sizes and durations, for reading.
 *
 * These lived in `money/currency.ts`, which is where they were found by anyone
 * grepping for a formatter and by nobody looking for them on purpose. A file
 * uploader importing from `@sailo/core/currency` to print "1.5 KB" is a
 * miscategorisation the call site announces every time it is read.
 *
 * Neither has anything to do with money: no currency, no minor units, no table.
 * They are here because five storefront and admin surfaces show a download size
 * or a track length and none of them should own the rounding.
 */

/**
 * Human file size for download listings: 1536 → "2 KB" — bytes and kilobytes
 * read better whole; megabytes deserve a decimal.
 *
 * `base` 1024 for storage listings, 1000 where a stated ceiling is decimal:
 * dispute evidence says "4.5 MB" because Stripe's limit is 4,500,000 bytes,
 * and rendering the same file "4.3 MB" beside that sentence reads as a
 * contradiction. One implementation with the base as the only choice, because
 * the second copy this replaces had already drifted into its own rounding.
 */
export function formatBytes(bytes: number, base: 1000 | 1024 = 1024) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(base)),
    units.length - 1,
  );
  const value = bytes / base ** exponent;
  return `${value >= 10 || exponent <= 1 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

/**
 * How long a service takes: "45 min", "1 h 30 min". The units stay as the
 * symbols rather than words — this string is dropped into all 22 storefront
 * languages, and "hr" would read as English in every one of them.
 */
export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
