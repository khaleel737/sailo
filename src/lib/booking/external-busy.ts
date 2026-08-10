import "server-only";
import { isPublicLinkUrl } from "@/lib/file-urls";
import { withRedis } from "@/lib/redis";
import { busyFromFeed } from "./calendar-feed";
import { zoneOf } from "./time-zone";
import type { Busy } from "./slots";

/**
 * Fetching the seller's calendar feed, and the two rules that govern it.
 *
 * **It fails open.** A calendar that will not load, will not parse, or times
 * out produces no busy ranges and therefore hides no slots — the shop keeps
 * exactly the availability it had before this feature existed. Failing closed
 * is worse in every direction: a Google outage would empty every seller's
 * calendar at once and the shop would look shut, which is a self-inflicted
 * outage with no upside. The degradation is logged and surfaced in settings
 * rather than swallowed, because a feed silently doing nothing is the failure
 * this feature is most likely to have.
 *
 * **The URL is the seller's, and the fetch is ours.** That makes this
 * server-side request forgery unless it is guarded — a seller could point the
 * feed at cloud metadata or an internal host and read the response through
 * the timing of their own booking page. Hence: https only, public hosts only,
 * redirects followed by hand with every hop re-checked, a byte ceiling and a
 * clock.
 */

/** How long a cached answer stands. Long enough to absorb a page's reads. */
const CACHE_SECONDS = 60;

/** Feeds are text; a megabyte of it is a decade of a busy calendar. */
const MAX_BYTES = 2 * 1024 * 1024;

/** A booking page must not wait on somebody else's server. */
const TIMEOUT_MS = 5_000;

/** Enough for the one hop providers actually use, and no more. */
const MAX_REDIRECTS = 3;

/**
 * How far ahead the cached answer reaches.
 *
 * One canonical window rather than the caller's, so every reader of a shop's
 * calendar shares one cache entry regardless of how many days it asked for.
 * A day of slack at the near end catches an event that began yesterday and
 * runs into today.
 */
const HORIZON_DAYS = 62;

export type FeedResult =
  | { ok: true; busy: Busy[] }
  | { ok: false; reason: string };

/**
 * Whether a string is a calendar feed we are willing to fetch.
 *
 * `isPublicLinkUrl` is the same denylist the terms link uses — https, no
 * loopback, no RFC1918, no link-local, no single-label host — and it is
 * reused rather than reimplemented because a second copy is a second thing to
 * forget to update. The danger here is strictly greater, though: a terms URL
 * is followed by the buyer's browser and this one is fetched by our server,
 * so it is paired with the redirect and size guards below.
 */
export function isCalendarFeedUrl(value: unknown): value is string {
  return isPublicLinkUrl(value);
}

/**
 * What a seller actually pastes, turned into what we can fetch.
 *
 * Every provider offers the link as `webcal://`, which is not a scheme any
 * fetch implements — it is an https URL wearing a hint to the operating
 * system that a calendar app should open it. Rewriting it is the difference
 * between the feature working on first paste and the seller being told their
 * own calendar's URL is invalid.
 */
export function normalizeFeedUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^webcals?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^webcals?:/i, "https:");
  }
  return trimmed;
}

/**
 * Fetches the feed, following redirects by hand.
 *
 * `redirect: "manual"` rather than the default, because the default follows a
 * 302 to wherever it points — and "wherever it points" is chosen by whoever
 * controls the seller's URL, which puts the internal network back in reach
 * one hop after the guard passed. Each hop is re-checked with the same rule
 * as the first.
 */
async function fetchFeed(url: string, signal: AbortSignal): Promise<Response> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, {
      signal,
      redirect: "manual",
      headers: {
        Accept: "text/calendar, text/plain;q=0.9, */*;q=0.1",
        "User-Agent": "Sailo-Calendar/1.0 (+https://sailo.store)",
      },
      // A calendar changes; a cached one that says the seller is free is the
      // failure mode this whole module exists to avoid.
      cache: "no-store",
    });

    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get("location");
    if (!location) return response;

    const next = new URL(location, current).toString();
    if (!isCalendarFeedUrl(next)) {
      throw new Error("the feed redirected somewhere we will not follow");
    }
    current = next;
  }

  throw new Error("too many redirects");
}

/** Reads at most `MAX_BYTES`, so a hostile feed cannot be a memory bill. */
async function readCapped(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let size = 0;
  let text = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        throw new Error(`the feed is larger than ${MAX_BYTES} bytes`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/**
 * The seller's external busy ranges, fetched fresh.
 *
 * Returns a reason rather than throwing, because every caller's answer to a
 * failure is the same — carry on with Sailo's own availability — and the
 * difference between them is only whether anyone is told.
 */
export async function fetchExternalBusy(opts: {
  url: string;
  timeZone: string;
  from: Date;
  to: Date;
}): Promise<FeedResult> {
  const url = normalizeFeedUrl(opts.url);
  if (!isCalendarFeedUrl(url)) {
    return { ok: false, reason: "that is not a calendar URL we can read" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetchFeed(url, controller.signal);
    if (!response.ok) {
      return { ok: false, reason: `the calendar answered ${response.status}` };
    }

    const text = await readCapped(response);
    /*
     * A provider that has decided the link is no longer valid answers 200
     * with a sign-in page, and an HTML body parses to an empty calendar —
     * which looks exactly like a calendar with nothing in it. Saying so is
     * the difference between the seller fixing a stale link and discovering
     * it when a buyer turns up during their holiday.
     */
    if (!text.includes("BEGIN:VCALENDAR")) {
      return { ok: false, reason: "that URL did not return a calendar" };
    }

    return {
      ok: true,
      busy: busyFromFeed(text, { from: opts.from, to: opts.to }, zoneOf(opts.timeZone)),
    };
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.name === "AbortError" || error.name === "TimeoutError"
          ? "the calendar took too long to answer"
          : error.message
        : "the calendar could not be read";
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

type CachedRange = [number, number];

/**
 * The shop's external busy ranges for a window, cached and failing open.
 *
 * The cache holds one canonical horizon per shop rather than one entry per
 * window asked for, so the storefront's fourteen days and the admin's sixty
 * share an entry. Redis being absent or cold is not an error here — it is the
 * ordinary case in development — and `withRedis` already resolves to the
 * fallback rather than throwing.
 */
export async function externalBusyFor(shop: {
  id: string;
  calendarFeedUrl: string | null;
  timeZone: string;
}, window: { from: Date; to: Date }, now: Date): Promise<Busy[]> {
  if (!shop.calendarFeedUrl) return [];

  const horizon = {
    from: new Date(now.getTime() - 24 * 3_600_000),
    to: new Date(now.getTime() + HORIZON_DAYS * 24 * 3_600_000),
  };

  const key = `calfeed:${shop.id}`;
  const cached = await withRedis<string | null>(
    (redis) => redis.get(key) as Promise<string | null>,
    null,
  );

  let ranges: CachedRange[] | null = null;
  if (cached) {
    try {
      const parsed: unknown = JSON.parse(cached);
      if (Array.isArray(parsed)) ranges = parsed as CachedRange[];
    } catch {
      // A cache is never a source of truth; unreadable means "not cached".
      ranges = null;
    }
  }

  if (ranges === null) {
    const result = await fetchExternalBusy({
      url: shop.calendarFeedUrl,
      timeZone: shop.timeZone,
      from: horizon.from,
      to: horizon.to,
    });

    if (!result.ok) {
      /*
       * Logged once per miss rather than swallowed. The seller sees the same
       * fact on the settings card, stamped by the sweep; this is for whoever
       * is reading production logs when a shop reports being double-booked.
       */
      console.warn(
        `[sailo] calendar feed for shop ${shop.id} degraded: ${result.reason}`,
      );
      /*
       * Cached as empty for a fraction of the normal life, so a failing feed
       * does not mean an outbound request on every single page view — but
       * recovers within a minute rather than staying dark for a full TTL.
       */
      await withRedis(
        (redis) => redis.set(key, "[]", { EX: 15 }),
        null,
      );
      return [];
    }

    ranges = result.busy.map(
      (busy): CachedRange => [busy.startsAt.getTime(), busy.endsAt.getTime()],
    );
    await withRedis(
      (redis) => redis.set(key, JSON.stringify(ranges), { EX: CACHE_SECONDS }),
      null,
    );
  }

  const from = window.from.getTime();
  const to = window.to.getTime();

  return ranges
    .filter(([start, end]) => end > from && start < to)
    .map(([start, end]) => ({ startsAt: new Date(start), endsAt: new Date(end) }));
}

/** Drops a shop's cached calendar, so a settings change takes effect at once. */
export async function forgetExternalBusy(shopId: string) {
  await withRedis((redis) => redis.del(`calfeed:${shopId}`), 0);
}
