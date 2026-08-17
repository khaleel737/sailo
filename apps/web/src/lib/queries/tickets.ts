/**
 * The door's reads, now in `@sailo/commerce/door-list`.
 *
 * Kept as a re-export because nine modules in this app import
 * `@/lib/queries/tickets` and none of them care where the query runs.
 *
 * They moved because `events.list` and `events.door` in `@sailo/api` answer
 * with exactly these shapes. The counters above a door and the guest list a
 * volunteer searches must not be able to disagree between the phone in their
 * hand and the laptop on the table behind them, and two implementations of
 * "who is still outside" is precisely how they would.
 */

export * from "@sailo/commerce/ticketing";
