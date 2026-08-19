/**
 * A public link to one number — spec 42.
 *
 * **The most dangerous feature in this spec**, and every rule below is what
 * makes it not be. A seller showing a partner or a landlord their revenue is a
 * real use; a public URL rendering a shop's revenue is a real hazard, and the
 * whole difference is in the constraints.
 *
 * Pure and client-safe. The token minting and the row reads are
 * `./shares-server`; what is here is the vocabulary and the rules, so the
 * dialog and the public page validate with the same functions the server does.
 */

/**
 * What a link may expose. **Aggregates only.**
 *
 * No order rows, no buyer names, no product-level breakdown unless the metric
 * *is* product performance — and even then it is titles and totals. There is
 * deliberately no `dashboard` value: a token that rendered a dashboard would
 * be a token whose scope grows every time somebody adds a tile to it.
 */
export const SHARE_METRICS = [
  "revenue",
  "orders",
  "visitors",
  "conversion",
  "topProducts",
] as const;
export type ShareMetric = (typeof SHARE_METRICS)[number];

export function isShareMetric(value: string): value is ShareMetric {
  return (SHARE_METRICS as readonly string[]).includes(value);
}

/** Windows a link may cover. Fixed at creation and not a parameter. */
export const SHARE_RANGES = ["7d", "30d", "90d", "365d"] as const;
export type ShareRange = (typeof SHARE_RANGES)[number];

export function isShareRange(value: string): value is ShareRange {
  return (SHARE_RANGES as readonly string[]).includes(value);
}

/** Days behind each range, for the query the public page runs. */
export const SHARE_RANGE_DAYS: Record<ShareRange, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

/**
 * How long a link may live.
 *
 * **Required, and capped.** A link that never expires is a permanent public
 * revenue feed, and "the seller can revoke it" is no answer for one they
 * forgot they made — the whole failure mode here is a link that outlives the
 * relationship it was made for.
 */
export const SHARE_DEFAULT_DAYS = 30;
export const SHARE_MAX_DAYS = 90;

export type ExpiryProblem = "tooLong" | "tooShort";

/**
 * The expiry a link should get, or why the asked-for one is refused.
 *
 * Refused rather than clamped, and that is the one place this file does not
 * follow "clamp and say so": a seller who typed 365 and silently got 90 has a
 * link they believe covers the year, and they will not look again. Ninety is
 * the maximum and being told so is the point.
 */
export function shareExpiry(
  days: number | null | undefined,
  now: Date,
): { ok: true; expiresAt: Date } | { ok: false; problem: ExpiryProblem } {
  const asked = days ?? SHARE_DEFAULT_DAYS;
  if (!Number.isInteger(asked) || asked < 1) return { ok: false, problem: "tooShort" };
  if (asked > SHARE_MAX_DAYS) return { ok: false, problem: "tooLong" };
  return { ok: true, expiresAt: new Date(now.getTime() + asked * 86_400_000) };
}

export type ShareState = "live" | "expired" | "revoked";

/**
 * Whether a link still works.
 *
 * Revoked outranks expired, because it is the answer the seller acted on: a
 * link they revoked reads "revoked" for ever, not "expired" once the date
 * passes, and a settings list that said otherwise would be telling them their
 * revocation had lapsed into something else.
 */
export function shareState(
  row: { expiresAt: Date; revokedAt: Date | null },
  now: Date,
): ShareState {
  if (row.revokedAt) return "revoked";
  return row.expiresAt.getTime() <= now.getTime() ? "expired" : "live";
}

/**
 * The scope a token carries, read back from its row.
 *
 * **One metric and one fixed range, and neither is in the URL.** The token
 * cannot be edited into a different number or a wider window, because there is
 * nothing to edit: the public route reads the row and takes the metric and the
 * range from it, and any query parameter on that URL is ignored.
 *
 * That is the single most important property of this feature. A design where
 * `?metric=` selected the figure would mean one shared link was every link.
 */
export function shareScope(row: {
  metric: string;
  range: string;
}): { metric: ShareMetric; range: ShareRange } | null {
  return isShareMetric(row.metric) && isShareRange(row.range)
    ? { metric: row.metric, range: row.range }
    : null;
}
