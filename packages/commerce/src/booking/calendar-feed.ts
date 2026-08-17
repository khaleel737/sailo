/**
 * Reading a seller's other calendar.
 *
 * Sailo's exclusion constraint makes a Sailo double-booking impossible and
 * does nothing about the funeral already in the seller's own calendar — which
 * is the double booking that actually happens to people. This turns the
 * read-only feed Google, Apple and Outlook each publish into the same `Busy`
 * ranges a Sailo appointment produces, so the slot generator subtracts both
 * without knowing which is which.
 *
 * Pure, and given the clock and the window it should answer for. Nothing here
 * fetches anything — `external-busy.ts` does that — so every rule below is
 * testable at the boundary where it bites: the recurring meeting on the week
 * the clocks change, the all-day event, the invitation that was declined.
 *
 * Only what makes a time unbookable is read. Titles, attendees, descriptions
 * and locations are deliberately never parsed and never stored: Sailo needs
 * to know that Tuesday at three is taken, and has no business knowing who
 * with.
 */

/** How many occurrences one recurrence rule may produce before we stop.
 *
 * WHY THIS IS AN ENTRY AND NOT AN IMPLEMENTATION
 *
 * 692 lines, and its own banners named all four layers: lexing, time, recurrence, events.
 * They are a pipeline rather than a pile — each one consumes what the last produced — and a
 * parser whose stages are separated is one where a malformed-input bug can be located.
 *
 *   ./ics-lex         unfolding, and `NAME;PARAM=VAL:value` into a shape
 *   ./ics-time        stamps and durations, where a calendar file lies about time
 *   ./ics-recurrence  RRULE, the part that generates rather than describes
 *   ./ics-events      which events count as busy, and the intervals they produce
 *
 * `calendar-feed.test.ts` beside this file drives them through the entry, which is why no
 * test moved: 32 cases against real provider output, and every one of them still enters here.
 */

/*
 * Named rather than `export *`, and that is the point of doing it by hand: the split had
 * to export a dozen internals — `Property`, `ZonedStamp`, `recurringDates`, the two
 * ceilings — so the stages could reach each other. Re-exporting them from here would turn
 * a parser's internals into this package's public surface, where the next reader is
 * entitled to depend on them. What was public before the split is what is public now.
 */
export { unfold, parseProperty } from "./ics-lex";
export { parseStamp, parseDuration } from "./ics-time";
export { parseRecurrence } from "./ics-recurrence";
export { busyFromFeed, type FeedWindow } from "./ics-events";
