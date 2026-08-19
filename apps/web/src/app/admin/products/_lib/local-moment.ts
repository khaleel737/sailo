/**
 * A stored instant, back into the `YYYY-MM-DDTHH:mm` a `datetime-local` wants —
 * read on the *shop's* clock, not the browser's.
 *
 * The round trip has to close. `shopMomentFrom` parses these fields as
 * wall-clock time in `shops.timeZone`, so rendering one in the viewer's zone
 * would move a seller's launch every time somebody opened the form from another
 * country: a seller in Lisbon and their assistant in Manila must see the same
 * 17:00, and whichever of them pressed Save last would otherwise have moved it.
 *
 * Its own module because three cards need it — spec 43's two window fields and
 * spec 33's preorder date — and a second copy that rounded midnight differently
 * is exactly the drift that puts a launch an hour out.
 *
 * `en-CA` gives ISO-ordered date parts, which is the shortest route to the
 * shape the input parses; the zone does the rest.
 */
export function localMoment(at: Date | null, timeZone: string): string {
  if (!at) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(at);

    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";

    // Midnight comes back as `24` under `hour12: false` in some runtimes — a
    // documented quirk rather than a bug in the data, and one that would render
    // an unparseable value into the field.
    const hour = get("hour") === "24" ? "00" : get("hour");
    return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
  } catch {
    /*
     * An unknown zone must not blank a seller's saved date. UTC is a worse
     * label and never a lost value — and `zoneOf` on the way back in makes the
     * same substitution, so the round trip still closes.
     */
    return at.toISOString().slice(0, 16);
  }
}
