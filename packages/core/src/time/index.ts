/**
 * Dates and windows, computed the way the database stores them.
 *
 * Everything here is UTC on purpose. Timestamps are stored as UTC wall-clock and
 * Postgres truncates in UTC, so anything that builds buckets or bounds in local
 * time disagrees with the rows it is counting — and disagrees *silently*, by one
 * day, for everyone in a timezone that is not ours.
 *
 * A shop's own timezone is a different subject and lives with the thing that
 * needs it: `@sailo/commerce/booking` converts opening hours into a seller's
 * local day, because that is a question about a booking rather than about a
 * count.
 */
export * from "./day-window";
