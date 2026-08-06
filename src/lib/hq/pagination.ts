
/** Reading page numbers and search terms out of a query string, safely. */

export const HQ_PAGE_SIZE = 25;

export const DAY_MS = 24 * 60 * 60 * 1000;

export const num = (value: unknown) => Number(value ?? 0);

export const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

/**
 * A search param, as a single string.
 *
 * `?state=paying&state=free` is legal and arrives as an array; taking the
 * first is the same thing every browser form would have sent.
 */
export function first(
  value: string | string[] | undefined,
): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() ? raw : undefined;
}

/** A positive page number from a query string, defaulting to the first. */
export function pageNumber(value: string | string[] | undefined): number {
  const parsed = Number(first(value));
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
}

/**
 * One page of a list, with its total.
 *
 * The page and the count go out together, because one waiting on the other
 * doubles the latency of every list in the panel for no reason. The re-read
 * only happens when the requested page is past the end — a stale bookmark, or
 * a filter change that shrank the results — and showing the last page beats an
 * empty table under a heading that says there are 200 rows.
 */
export async function paginate<Row>(
  requested: number,
  fetchPage: (offset: number) => Promise<Row[]>,
  countAll: () => Promise<number>,
) {
  const page = Math.max(1, Math.floor(requested || 1));

  const [rows, total] = await Promise.all([
    fetchPage((page - 1) * HQ_PAGE_SIZE),
    countAll(),
  ]);

  const pages = Math.max(1, Math.ceil(total / HQ_PAGE_SIZE));
  if (page <= pages) return { rows, total, page, pages };

  return {
    rows: await fetchPage((pages - 1) * HQ_PAGE_SIZE),
    total,
    page: pages,
    pages,
  };
}

/** Escapes the wildcards so a search for "50%" doesn't match everything. */
export function like(term: string) {
  return `%${term.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The UTC day buckets a chart is drawn over. Timestamps are stored as UTC and
 * Postgres `::date` truncates in UTC, so building these in local time silently
 * drops today's bucket for anyone ahead of Greenwich.
 */
export function utcDayWindow(days: number) {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  const keys: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setUTCDate(since.getUTCDate() + i);
    keys.push(d.toISOString().slice(0, 10));
  }
  return { since, keys };
}

/* -------------------------------------------------------------------------- */
/*  Billing state, expressed as a query                                        */
/* -------------------------------------------------------------------------- */
