/**
 * Whether to ask this browser to join a shop's mailing list.
 *
 * A sibling of `shop-consent.ts`, and keyed per shop for the same reason: two
 * storefronts share our origin but nothing else, so somebody who said "not
 * now" to one shop has said nothing about the next one they open.
 *
 * The whole point of a popup is that it asks without being asked, which is
 * also what makes it a nuisance the second time. So the answer is recorded on
 * the device and the two answers expire differently:
 *
 * - **subscribed** never expires. Somebody who typed their address in must
 *   not be asked again by the same browser, ever — and the answer is written
 *   the moment the form is submitted, not when the confirmation link is
 *   clicked, because the clicking usually happens in a mail app on another
 *   device and this browser would otherwise go on asking.
 * - **dismissed** expires. A visitor who closed the card in March is a
 *   different proposition in June, and a permanent no would mean one
 *   distracted click costs the seller that address forever.
 *
 * `localStorage`, not a cookie: this is a preference about a widget on the
 * device, it is never read on the server, and a storefront should not set a
 * cookie to remember that somebody closed a box.
 */

/** Bumped if the ask itself changes enough that old answers are stale. */
export const SUBSCRIBE_PROMPT_VERSION = 1;

/** How long "not now" lasts before the popup may ask again. */
export const SUBSCRIBE_SNOOZE_DAYS = 45;

export type SubscribePromptState = "dismissed" | "subscribed";

export type SubscribePromptRecord = {
  state: SubscribePromptState;
  version: number;
  /** ISO date — what the snooze is measured from. */
  at: string;
};

/** Fired when the answer changes, so a card and a popup agree without a reload. */
export const SUBSCRIBE_PROMPT_EVENT = "sailo:subscribe-prompt";

export function subscribePromptKey(shopId: string): string {
  return `sailo_subscribe:${shopId}`;
}

export function readSubscribePrompt(
  shopId: string,
): SubscribePromptRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(subscribePromptKey(shopId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("state" in parsed) ||
      !("version" in parsed)
    ) {
      return null;
    }
    const record = parsed as SubscribePromptRecord;
    if (record.version !== SUBSCRIBE_PROMPT_VERSION) return null;
    if (record.state !== "dismissed" && record.state !== "subscribed") {
      return null;
    }
    return record;
  } catch {
    // Private browsing, a full quota, a hand-edited value. Every one of them
    // is "no answer on file", and the popup's own gates decide the rest.
    return null;
  }
}

/**
 * Whether the popup may open at all.
 *
 * Failing *towards* asking is deliberate and is the opposite of the consent
 * banner's rule. There, an unreadable store must never be read as a yes,
 * because the cost of guessing wrong is loading somebody's trackers without
 * permission. Here the cost of guessing wrong is showing a signup card to
 * somebody who already closed one, which is an annoyance and not a breach.
 */
export function shouldAskToSubscribe(shopId: string, now = new Date()): boolean {
  const record = readSubscribePrompt(shopId);
  if (!record) return true;
  if (record.state === "subscribed") return false;

  const at = Date.parse(record.at);
  // An unparseable timestamp is a record we cannot age, so treat it as one
  // that has aged out rather than as a silent permanent no.
  if (Number.isNaN(at)) return true;
  return now.getTime() - at >= SUBSCRIBE_SNOOZE_DAYS * 86_400_000;
}

function write(shopId: string, state: SubscribePromptState): void {
  if (typeof window === "undefined") return;
  const record: SubscribePromptRecord = {
    state,
    version: SUBSCRIBE_PROMPT_VERSION,
    at: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(
      subscribePromptKey(shopId),
      JSON.stringify(record),
    );
  } catch {
    // Nothing to do: the popup closes on its own state either way, and the
    // worst case is being asked again on the next visit.
  }
  window.dispatchEvent(new CustomEvent(SUBSCRIBE_PROMPT_EVENT));
}

/** "Not now" — quiet for `SUBSCRIBE_SNOOZE_DAYS`, then askable again. */
export function dismissSubscribePrompt(shopId: string): void {
  write(shopId, "dismissed");
}

/**
 * They typed an address in. Recorded wherever the form lives — the popup, the
 * card under the products, or the shareable page — so joining from one closes
 * the other two.
 */
export function markSubscribed(shopId: string): void {
  write(shopId, "subscribed");
}
