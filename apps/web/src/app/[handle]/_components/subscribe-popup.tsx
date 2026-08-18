"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Mail, X } from "lucide-react";
import {
  SUBSCRIBE_PROMPT_EVENT,
  dismissSubscribePrompt,
  shouldAskToSubscribe,
} from "@sailo/customers/subscribe-prompt";
import {
  SHOP_CONSENT_EVENT,
  readShopConsent,
} from "@sailo/customers/shop-consent";
import { useCart } from "./cart/cart-provider";
import {
  SUBSCRIBE_CARD_ID,
  SubscribeForm,
  type SubscribeLabels,
} from "./subscribe-card";

/**
 * The signup, as something that comes to the visitor.
 *
 * The card under the products only ever reaches the minority who scroll to
 * the end of a catalogue — which on a storefront is a small fraction of a
 * small fraction, and is why a seller with three hundred customers has eleven
 * contacts. This asks the rest.
 *
 * A popup is a tax on somebody's attention, so the whole design here is about
 * when it may be levied. It is not a modal: no backdrop, no focus trap, no
 * scroll lock. The page stays usable behind it, Escape closes it, and every
 * gate below is a reason *not* to show it.
 *
 * **Earned, not immediate.** Nothing before `MIN_DWELL_MS` — a card thrown at
 * somebody who has not seen the shop yet is asking for an address to a
 * newsletter about products they have not looked at. After that it needs a
 * sign of interest: scrolled `SCROLL_DEPTH` of the page, or `DWELL_MS` spent
 * reading it.
 *
 * **Never twice.** Closing it snoozes it for weeks and subscribing anywhere
 * — here, the card, the shareable page — silences it for good, both through
 * `subscribe-prompt.ts` and both across tabs.
 *
 * **Never over something that matters more.** Not while the consent banner is
 * still waiting for an answer, because two dialogs stacked in the same corner
 * is one covering the other. Not while the basket has anything in it or is
 * open, because a person mid-purchase is doing the thing the shop actually
 * wants and interrupting them to ask for an email is the trade nobody would
 * make on purpose. And not while the card under the products is on screen,
 * which would be the same question asked twice in one viewport.
 */

/** Nothing at all before this. */
const MIN_DWELL_MS = 6_000;
/** Reading the shop this long is interest enough on its own. */
const DWELL_MS = 20_000;
/** Or this far down it, which is the same signal for a fast scroller. */
const SCROLL_DEPTH = 0.4;
/** A page shorter than this cannot report depth honestly; dwell carries it. */
const MIN_SCROLLABLE_PX = 240;
/** How long the "check your inbox" answer stays before the card withdraws. */
const DONE_MS = 6_000;

/** Both stores that can silence this, so either one closes it in every tab. */
function subscribeToPromptState(onChange: () => void) {
  window.addEventListener(SUBSCRIBE_PROMPT_EVENT, onChange);
  window.addEventListener(SHOP_CONSENT_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SUBSCRIBE_PROMPT_EVENT, onChange);
    window.removeEventListener(SHOP_CONSENT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function SubscribePopup({
  shopId,
  handle,
  labels,
  incentive,
  /**
   * Whether this storefront shows the consent banner at all.
   *
   * Server-side knowledge — it depends on whether the seller configured any
   * tags — and without it "no answer stored" would be indistinguishable from
   * "never asked", which would hold this popup back forever on the majority
   * of shops that have no banner.
   */
  awaitsConsent,
}: {
  shopId: string;
  handle: string;
  labels: SubscribeLabels & { close: string };
  incentive?: string | null;
  awaitsConsent: boolean;
}) {
  /*
   * Eligibility is external state: another tab can subscribe, and it cannot
   * be read while rendering on the server — where the answer must be "no",
   * or every visitor gets a flash of a popup they already dismissed.
   */
  const eligible = useSyncExternalStore(
    subscribeToPromptState,
    useCallback(
      () =>
        shouldAskToSubscribe(shopId) &&
        (!awaitsConsent || readShopConsent(shopId) !== null),
      [shopId, awaitsConsent],
    ),
    () => false,
  );

  const cart = useCart();
  const busy = Boolean(cart && (cart.count > 0 || cart.open));

  const [armed, setArmed] = useState(false);
  const [open, setOpen] = useState(false);
  /* Closed once is closed for this page view, whatever the gates say after. */
  const [spent, setSpent] = useState(false);
  const [cardVisible, setCardVisible] = useState(false);

  /* The two signs of interest. Neither timer is even started for somebody who
     will not be asked, so a returning visitor costs nothing. */
  useEffect(() => {
    if (!eligible || armed || spent) return;

    let ready = false;
    const check = () => {
      if (!ready) return;
      const scrollable =
        document.documentElement.scrollHeight - window.innerHeight;
      if (scrollable < MIN_SCROLLABLE_PX) return;
      if (window.scrollY / scrollable >= SCROLL_DEPTH) setArmed(true);
    };

    const floor = window.setTimeout(() => {
      ready = true;
      // A visitor who landed already scrolled — a back button, a restored
      // position, an anchor — has given the signal before we started looking.
      check();
    }, MIN_DWELL_MS);
    const dwell = window.setTimeout(() => setArmed(true), DWELL_MS);
    window.addEventListener("scroll", check, { passive: true });

    return () => {
      window.clearTimeout(floor);
      window.clearTimeout(dwell);
      window.removeEventListener("scroll", check);
    };
  }, [eligible, armed, spent]);

  /* The card under the products, watched rather than assumed: it is optional,
     the seller can switch it off, and this popup must not double it. */
  useEffect(() => {
    const card = document.getElementById(SUBSCRIBE_CARD_ID);
    if (!card) return;
    const observer = new IntersectionObserver(([entry]) =>
      setCardVisible(entry?.isIntersecting ?? false),
    );
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  /*
   * Opening is gated; being open is not. Once it is up, a basket that fills or
   * a card that scrolls into view must not yank it out from under somebody
   * halfway through typing their address.
   */
  useEffect(() => {
    if (open || spent || !armed || !eligible || busy || cardVisible) return;
    setOpen(true);
  }, [open, spent, armed, eligible, busy, cardVisible]);

  const close = useCallback(() => {
    setOpen(false);
    setSpent(true);
  }, []);

  /* The X and Escape are a "not now", and are recorded as one. */
  const dismiss = useCallback(() => {
    dismissSubscribePrompt(shopId);
    close();
  }, [shopId, close]);

  /* A finished signup wrote `subscribed` already; this only clears the card
     off the screen, and never over the answer with a weaker one. */
  const done = useCallback(() => {
    window.setTimeout(close, DONE_MS);
  }, [close]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      /*
       * Not modal, and it says so. The page behind stays readable and
       * operable, which is the difference between a shop that asks and one
       * that blocks the door — and it is also what lets the cart pill and the
       * catalogue keep working underneath.
       */
      aria-modal="false"
      aria-labelledby="subscribe-popup-title"
      className={[
        "surface-card fixed z-50 rounded-2xl p-5 shadow-lg",
        /* A sheet on a phone: full width at the bottom, where a thumb is, and
           clear of the home indicator rather than tucked under it. */
        "animate-sheet-up inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))]",
        /* A card in the corner on a desktop, out of the catalogue's way and
           on the side the cart pill is not. */
        "sm:animate-pop sm:inset-x-auto sm:bottom-6 sm:start-6 sm:w-[22rem]",
      ].join(" ")}
    >
      <div className="flex items-start gap-2">
        <Mail className="mt-0.5 size-4 shrink-0 opacity-60" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="subscribe-popup-title" className="text-base font-semibold">
            {labels.title}
          </h2>
          <p className="text-muted mt-1.5 text-sm leading-relaxed">
            {labels.body}
          </p>
          {incentive ? (
            <p className="mt-2 text-sm font-semibold">{incentive}</p>
          ) : null}
        </div>
        {/* `-me-2 -mt-2` so the 44px target the finger needs does not push the
            heading down by the padding it eats. */}
        <button
          type="button"
          onClick={dismiss}
          aria-label={labels.close}
          className="focus-ring -me-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-full opacity-60 transition hover:opacity-100"
        >
          <X className="size-4" />
        </button>
      </div>

      <SubscribeForm
        handle={handle}
        shopId={shopId}
        labels={labels}
        idPrefix="subscribe-popup"
        stacked
        onDone={done}
      />
    </div>
  );
}
