/**
 * Turning a calendar file into properties.
 *
 * The tokeniser: line unfolding and `NAME;PARAM=VAL:value` into a shape. Its own module
 * because it is the layer that has to survive whatever a calendar provider actually emits —
 * folded lines mid-UTF-8, quoted parameters, escaped commas — and none of that has anything
 * to do with what a booking is.
 *
 * The two ceilings live here as well: an untrusted URL feeds this, so a file with a million
 * occurrences is a request we serve, not a bug we hit.
 */



export const MAX_OCCURRENCES = 10_000;

/** How many events one feed may contribute. A calendar, not a database. */
export const MAX_EVENTS = 5_000;

/* -------------------------------------------------------------------------- */
/*  Lines and properties                                                       */
/* -------------------------------------------------------------------------- */

export type Property = {
  name: string;
  params: Record<string, string>;
  value: string;
};

/**
 * Undoes RFC 5545 line folding.
 *
 * A long property is split across lines with each continuation beginning with
 * a space or a tab, and that is not cosmetic: a `RRULE` for a weekly meeting
 * routinely exceeds the 75-octet limit, so a parser that reads lines as
 * written sees half a rule and expands nothing. Accepts CRLF, LF and CR
 * because plenty of feeds are re-served by something that normalised them.
 */
export function unfold(ics: string): string[] {
  const lines = ics.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];

  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }

  return out.filter((line) => line.trim() !== "");
}

/**
 * `DTSTART;TZID=Europe/Berlin:20260810T090000` → name, params, value.
 *
 * The split is on the first colon *outside* a quoted parameter, because
 * `TZID="America/New York"` is legal and a naive `indexOf(":")` would cut a
 * zone in half — and a zone read wrong is an hour of the seller's day
 * misplaced rather than an error anyone sees.
 */
export function parseProperty(line: string): Property | null {
  let quoted = false;
  let colon = -1;

  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);

  const segments: string[] = [];
  let current = "";
  quoted = false;
  for (const c of head) {
    if (c === '"') quoted = !quoted;
    if (c === ";" && !quoted) {
      segments.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  segments.push(current);

  const name = (segments.shift() ?? "").trim().toUpperCase();
  if (!name) return null;

  const params: Record<string, string> = {};
  for (const segment of segments) {
    const eq = segment.indexOf("=");
    if (eq === -1) continue;
    params[segment.slice(0, eq).trim().toUpperCase()] = segment
      .slice(eq + 1)
      .trim()
      .replace(/^"|"$/g, "");
  }

  return { name, params, value: value.trim() };
}
