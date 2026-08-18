/**
 * Moved to `@sailo/core/csv`.
 *
 * The staff panel's export route went with apps/hq, and one app cannot import
 * another — but CSV writing was never web's to own anyway: it is string
 * escaping and a money formatter, with no request, no database and no Next in
 * it. Re-exported from here because six files in this app name this path.
 *
 * New code should import from `@sailo/core/csv` directly.
 */
export * from "@sailo/core/csv";
