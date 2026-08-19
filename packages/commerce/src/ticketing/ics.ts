/**
 * The calendar entry a buyer expects — spec 50.
 *
 * Sailo already *reads* iCal for booking (spec 17's feed). This is the write
 * direction for one object, which is far smaller than the calendar-write that
 * spec deferred, and it is the highest ratio of "buyer expects it" to "lines of
 * code" in the whole plan.
 *
 * Pure and database-free, so the confirmation email, the delivery page and the
 * reminder all produce the same bytes. A calendar entry that differs between
 * the email and the page is two events in somebody's diary.
 *
 * ─── THE THREE PROPERTIES THAT MAKE THIS WORK RATHER THAN MERELY PARSE ──────
 *
 * **A stable `UID` per (order, session).** A reissue — a resend, a transfer, a
 * corrected time — must *update* the entry the attendee already has rather
 * than adding a second one. Every calendar client keys on `UID`, so deriving
 * it rather than randomising it is the whole difference between "the event
 * moved" and "there are now two of them".
 *
 * **`SEQUENCE` increments on a change.** Without it a client is entitled to
 * ignore the update, and a rescheduled event sits in the attendee's calendar
 * at the old time — which is worse than never having sent one, because they
 * trust it.
 *
 * **`DTSTART` in UTC with a `VTIMEZONE` for the event's own zone.** UTC is
 * what every client agrees about; the `VTIMEZONE` is what lets the entry say
 * "19:00 Gulf Standard Time" to somebody reading it in London. A seller in
 * Dubai running a webinar for a London audience is the normal case, and it is
 * why the zone is per event rather than per shop.
 */

export type IcsEvent = {
  /** Stable per (order, session) — see `icsUid`. */
  uid: string;
  /** Bumped whenever anything below changes. */
  sequence: number;
  startsAt: Date;
  endsAt: Date | null;
  summary: string;
  description?: string | null;
  /** The venue, for an in-person event. */
  location?: string | null;
  /** The join link, for an online one. */
  url?: string | null;
  /** The event's own zone. Named beside the times, not used to shift them. */
  timeZone?: string | null;
  organizer?: { name: string; email: string | null } | null;
  /** `CANCELLED` for a session the seller called off. */
  cancelled?: boolean;
  /** Injected so the output is byte-stable in a test. */
  stamp?: Date;
};

/**
 * The identifier a calendar keys on.
 *
 * Derived rather than random, and derived from the two things that identify
 * *this attendee's copy of this occurrence*: their order and the session. A
 * random UID would make every resend a new event in their diary, which is the
 * single most common complaint about ticketing calendar files.
 *
 * The domain suffix is required by RFC 5545 and is ours rather than the
 * seller's: it identifies who minted the id, not who is running the event.
 */
export function icsUid(orderId: string, sessionId?: string | null): string {
  return `${orderId}${sessionId ? `-${sessionId}` : ""}@sailo.store`;
}

/** `20260901T190000Z` — the only form every client agrees about. */
function utc(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/**
 * Escapes one property value.
 *
 * Backslash first, or the escapes this adds get escaped again. Newlines become
 * the literal `\n` a description is allowed to carry; a raw one would end the
 * property and make everything after it an unknown line.
 */
function esc(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Folds a line to 75 octets, which RFC 5545 requires and several clients
 * enforce by truncating rather than by complaining.
 *
 * Counted in UTF-8 *bytes* rather than characters, because that is what the
 * limit is — a description in Arabic or Japanese folds at half as many
 * characters, and folding by `length` produces lines that are legal-looking
 * and too long.
 *
 * A continuation begins with a single space, which the parser strips.
 */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const out: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never split a multi-byte character: back off until the next byte is not
    // a continuation byte.
    /*
     * `?? 0` rather than a non-null assertion: `end < bytes.length` already
     * proves the index is in range, but the compiler cannot see it through
     * `noUncheckedIndexedAccess` and an assertion here would be a claim rather
     * than a check. Zero is not a continuation byte, so the loop stops on it —
     * which is the right answer for an index that cannot happen.
     */
    while (end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
    out.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    // Continuations carry a leading space, so they hold one octet less.
    limit = 74;
  }
  return out.join("\r\n ");
}

/**
 * A `VTIMEZONE` for the event's own zone.
 *
 * Deliberately minimal: one `STANDARD` component carrying the offset that
 * applies at the event's own instant, rather than a full historical ruleset.
 * A generated file cannot carry the whole tz database, and every client that
 * matters resolves `TZID` against its own copy anyway — what this is for is
 * naming the zone so the entry can *say* which clock the seller meant.
 *
 * Returns null when the runtime does not know the zone, in which case the file
 * carries UTC times and no `TZID`, which is correct rather than merely safe:
 * the instants are right and only the label is missing.
 */
function vtimezone(timeZone: string, at: Date): string[] | null {
  const offset = offsetMinutes(timeZone, at);
  if (offset === null) return null;

  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const stamp = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}${String(abs % 60).padStart(2, "0")}`;

  return [
    "BEGIN:VTIMEZONE",
    `TZID:${timeZone}`,
    "BEGIN:STANDARD",
    // The epoch, because this component describes the offset rather than a
    // transition anybody is meant to compute from.
    "DTSTART:19700101T000000",
    `TZOFFSETFROM:${stamp}`,
    `TZOFFSETTO:${stamp}`,
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
}

/** A zone's offset from UTC at an instant, in minutes. Null if unknown. */
export function offsetMinutes(timeZone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      timeZoneName: "longOffset",
    }).formatToParts(at);
    const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    // "GMT+04:00", and plain "GMT" for UTC itself.
    const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
    if (!match) return name.startsWith("GMT") ? 0 : null;
    const sign = match[1] === "-" ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3]));
  } catch {
    return null;
  }
}

/**
 * One `.ics` file, CRLF-terminated as the spec requires.
 *
 * `PUBLISH` rather than `REQUEST`, and that is a decision: `REQUEST` asks the
 * attendee to RSVP and makes the seller's address the organiser of a meeting
 * invitation, which puts replies in their inbox and, in Outlook, tracking in
 * their calendar. A ticket is not a meeting invitation — nobody is being asked
 * whether they will come, they have paid.
 */
export function buildIcs(event: IcsEvent): string {
  const stamp = event.stamp ?? new Date();
  const zone = event.timeZone ?? null;
  const tz = zone ? vtimezone(zone, event.startsAt) : null;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sailo//Tickets//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    /*
     * A calendar-level property, not an event one — Apple and Google both read
     * it here and ignore it inside a `VEVENT`. It is what makes a client that
     * does not resolve `TZID` still show the seller's own clock.
     */
    ...(zone && tz ? [`X-WR-TIMEZONE:${zone}`] : []),
    ...(tz ?? []),
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `SEQUENCE:${Math.max(0, Math.trunc(event.sequence))}`,
    `DTSTAMP:${utc(stamp)}`,
    `DTSTART:${utc(event.startsAt)}`,
  ];

  /*
   * An end, when the seller gave one.
   *
   * `DURATION:PT1H` rather than nothing when they did not, because a `VEVENT`
   * with no end is an all-day event in several clients — an evening show would
   * block the attendee's whole Saturday.
   */
  if (event.endsAt && event.endsAt.getTime() > event.startsAt.getTime()) {
    lines.push(`DTEND:${utc(event.endsAt)}`);
  } else {
    lines.push("DURATION:PT1H");
  }

  lines.push(`SUMMARY:${esc(event.summary)}`);
  if (event.description) lines.push(`DESCRIPTION:${esc(event.description)}`);
  if (event.location) lines.push(`LOCATION:${esc(event.location)}`);
  if (event.url) lines.push(`URL:${esc(event.url)}`);
  if (event.organizer?.email) {
    lines.push(
      `ORGANIZER;CN=${esc(event.organizer.name)}:mailto:${event.organizer.email}`,
    );
  }
  /*
   * `STATUS:CANCELLED` with a bumped `SEQUENCE` is what actually removes an
   * event from somebody's calendar. Sending nothing leaves a cancelled session
   * sitting in every attendee's diary, and they turn up.
   */
  lines.push(`STATUS:${event.cancelled ? "CANCELLED" : "CONFIRMED"}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** The filename a browser and a mail client both handle. */
export function icsFilename(title: string): string {
  const clean = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${clean || "event"}.ics`;
}
