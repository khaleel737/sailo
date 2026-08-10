/**
 * Whether the visitor has agreed to analytics.
 *
 * Only Sailo's own surfaces ask this question. Nothing of ours stores
 * anything on a seller's storefront — see `visitor-id.ts` — so our banner
 * never appears there. When a seller connects marketing tags of their own,
 * the storefront asks its own question from `shop-consent.ts`: a different
 * controller, a different store, keyed per shop, and deliberately never
 * read as an answer to this one.
 *
 * The choice is kept in `localStorage`, not a cookie. Storing a consent
 * decision is itself exempt — it exists solely to honour what the visitor
 * asked for — and keeping it out of the cookie jar means the cookie table in
 * the privacy policy stays the short, true list it is.
 */

export const CONSENT_KEY = "sailo_consent";

/** Bumped if the categories change, which makes an old answer stale. */
export const CONSENT_VERSION = 1;

export type ConsentChoice = "granted" | "denied";

export type ConsentRecord = {
  analytics: ConsentChoice;
  version: number;
  /** ISO date, so a regulator asking "when did they agree" has an answer. */
  at: string;
};

/** Fired when the choice changes, so the tag can mount without a reload. */
export const CONSENT_EVENT = "sailo:consent";

export function readConsent(): ConsentRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("analytics" in parsed) ||
      !("version" in parsed)
    ) {
      return null;
    }
    const record = parsed as ConsentRecord;
    // A stored answer to a different question is not an answer.
    if (record.version !== CONSENT_VERSION) return null;
    if (record.analytics !== "granted" && record.analytics !== "denied") {
      return null;
    }
    return record;
  } catch {
    // Private browsing, a full quota, a hand-edited value: treat every one of
    // them as "not asked yet" rather than as consent.
    return null;
  }
}

export function writeConsent(analytics: ConsentChoice): void {
  if (typeof window === "undefined") return;
  const record: ConsentRecord = {
    analytics,
    version: CONSENT_VERSION,
    at: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify(record));
  } catch {
    // Nothing to do. The banner will ask again next time, which is the safe
    // direction to fail in.
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT));
}

/**
 * Forgets the answer, so the banner asks again.
 *
 * Withdrawing has to be as easy as giving — a policy page saying "clear your
 * browser storage" is not a mechanism, it is an instruction to do our job for
 * us. This is what the footer's cookie link calls, and the tag unmounts on the
 * same event that mounted it, so nothing further is measured from the click.
 */
export function clearConsent(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CONSENT_KEY);
  } catch {
    // Nothing stored, nothing to forget.
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT));
}

export function hasAnalyticsConsent(): boolean {
  return readConsent()?.analytics === "granted";
}
