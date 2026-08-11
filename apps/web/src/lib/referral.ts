"use client";

const KEY = "sailo_ref";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

type Stored = { code: string; shopId: string; at: number };

/** Last-touch attribution: a newer ?ref= replaces whatever was stored. */
export function saveReferralCode(shopId: string, code: string) {
  try {
    const payload: Stored = { code, shopId, at: Date.now() };
    window.localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Private browsing or a full quota — attribution is best-effort.
  }
}

export function readReferralCode(shopId?: string): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Stored;
    if (!parsed?.code) return null;
    if (Date.now() - parsed.at > TTL_MS) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    // A code only counts for the shop it was captured on.
    if (shopId && parsed.shopId !== shopId) return null;
    return parsed.code;
  } catch {
    return null;
  }
}
