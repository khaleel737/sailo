/**
 * What an event may be sold in — spec 50's ceilings and its one date rule.
 *
 * Pure, and in `@sailo/core` for the reason `variants.ts` is: the seller's
 * editor is a client component and cannot import the write path, but a ceiling
 * the browser does not know about is a ceiling the seller meets as a silently
 * dropped row. `MAX_VARIANTS` is here for the same reason.
 */

/**
 * Price bands on one event.
 *
 * Far more than any real on-sale uses, and that is not the point: a repeater
 * posting rows a browser composed needs a ceiling before those rows become
 * inserts.
 */
export const MAX_TIERS = 12;

/**
 * Dates one event runs on.
 *
 * A weekly class generated for a year is fifty-two, and a seller with more
 * dates than that is running a venue rather than an event. The same number
 * `generateSessions` clamps its own count to, arrived at from the other side.
 */
export const MAX_SESSIONS = 52;

/**
 * "The same workshop, four Tuesdays" — as wall-clock strings, not instants.
 *
 * **Deliberately not a recurrence rule.** No RRULE, no stored pattern, no
 * infinite series: this returns rows the seller can then edit individually,
 * which is a shape that never has to answer "what does editing the series do to
 * the one you have already sold tickets for". `generateSessions` writes the
 * same thing server-side for a caller that has no editor.
 *
 * The arithmetic runs in UTC on purpose. The input and the output are both
 * `datetime-local` strings — a wall clock with no zone attached — and UTC has
 * no daylight saving, so adding seven days lands on the same weekday at the
 * same clock time every time. Doing it against the browser's own zone would
 * move a 19:00 class to 18:00 for the half of the year on the other side of a
 * clock change, which is precisely what a seller does not mean by "weekly".
 *
 * Answers an empty list for anything that is not the one shape a
 * `datetime-local` input produces, because a blank first date is a seller who
 * has not chosen one yet rather than an error to shout about.
 */
export function repeatWeekly(startsAt: string, count: number): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(startsAt.trim());
  if (!m) return [];

  // The same ceiling the list itself has: one press cannot exceed what the
  // event may hold, and the caller trims again against what it already has.
  const wanted = Math.max(1, Math.min(MAX_SESSIONS, Math.trunc(count)));
  if (!Number.isFinite(wanted)) return [];

  const base = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
  );

  return Array.from({ length: wanted }, (_, i) =>
    toLocalInput(new Date(base + (i + 1) * 7 * 86_400_000)),
  );
}

/* -------------------------------------------------------------------------- */
/*  What the buyer is offered                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One band, as the buy box draws it.
 *
 * Trimmed rather than the row, for the reason every shape in `variants.ts` is:
 * the picker is a client component, and shipping `event_tiers` whole would put
 * a seller's internal counters in the page source of a public storefront.
 * `seatsLeft` is derived and `sold` never travels.
 */
export type BuyTier = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  /** Seats left in this band, or null when it shares the room's stock. */
  seatsLeft: number | null;
  soldOut: boolean;
  maxPerOrder: number | null;
};

/** One date, as the buy box draws it. */
export type BuySession = {
  id: string;
  startsAt: Date;
  endsAt: Date | null;
  location: string | null;
  cancelled: boolean;
  seatsLeft: number | null;
  soldOut: boolean;
};

/** The row shapes these are built from, narrow enough to pass a trimmed one. */
type TierRow = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  capacity: number | null;
  sold: number;
  maxPerOrder: number | null;
  isHidden: boolean;
  sellFrom: Date | null;
  sellUntil: Date | null;
};

type SessionRow = {
  id: string;
  startsAt: Date;
  endsAt: Date | null;
  capacity: number | null;
  sold: number;
  location: string | null;
  isCancelled: boolean;
};

/**
 * The bands a buyer may see, and which of them have run out.
 *
 * **Sold out is a state, not an absence.** A band that has gone stays on the
 * page, struck through and unpressable, because a buyer who came for VIP needs
 * to see that VIP is what has gone rather than wonder whether they mis-read the
 * page. Removing it is also how a seller gets told their tier "disappeared".
 *
 * A hidden band is not listed at all — that is what "comp or press tier,
 * reachable by direct link only" means — unless the request named it, which is
 * what following the link *is*. `resolveLines` sells it either way: the link is
 * the credential, and a checkout that refused it would make the link go
 * nowhere.
 *
 * A band outside its own sell window is dropped rather than struck through.
 * Early bird that closed on Friday is not sold out, it is over, and a
 * struck-through row would tell the buyer the wrong thing about why.
 */
export function buyableTiers(
  tiers: TierRow[],
  opts: { now: Date; reveal?: string | null } = { now: new Date() },
): BuyTier[] {
  const now = opts.now.getTime();
  return tiers
    .filter((tier) => !tier.isHidden || tier.id === opts.reveal)
    .filter((tier) => !tier.sellFrom || tier.sellFrom.getTime() <= now)
    .filter((tier) => !tier.sellUntil || tier.sellUntil.getTime() > now)
    .map((tier) => {
      const seatsLeft =
        tier.capacity === null ? null : Math.max(0, tier.capacity - tier.sold);
      return {
        id: tier.id,
        name: tier.name,
        description: tier.description,
        priceCents: tier.priceCents,
        seatsLeft,
        soldOut: seatsLeft === 0,
        maxPerOrder: tier.maxPerOrder,
      };
    });
}

/**
 * The dates a buyer may pick between, soonest first.
 *
 * A date that has started is gone from the list: nobody is buying a ticket for
 * a class that began an hour ago, and leaving it selectable is a refusal the
 * checkout would have to produce instead. A **cancelled** one stays and says so
 * — somebody holding a ticket for it is the person most likely to be on this
 * page, and an absence answers none of their questions.
 */
export function buyableSessions(
  sessions: SessionRow[],
  now = new Date(),
): BuySession[] {
  return sessions
    .filter((session) => session.startsAt.getTime() > now.getTime())
    .map((session) => {
      const seatsLeft =
        session.capacity === null
          ? null
          : Math.max(0, session.capacity - session.sold);
      return {
        id: session.id,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        location: session.location,
        cancelled: session.isCancelled,
        seatsLeft,
        soldOut: seatsLeft === 0,
      };
    });
}

/** A UTC instant back as the `YYYY-MM-DDTHH:mm` a browser input reads. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  );
}
