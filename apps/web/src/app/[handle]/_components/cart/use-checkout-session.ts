"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { recordCheckoutOpened } from "@/lib/actions/checkout-session";

/**
 * The recovery session behind an open checkout — spec 32.
 *
 * Two jobs, and the second is the one with a rule behind it.
 *
 * **It records that the checkout was opened**, once, and again when the buyer
 * types an address in — because an address is what makes them recoverable at
 * all, and a session written before they typed one has nowhere to send.
 * Debounced, so a buyer typing their address does not write a row per
 * keystroke.
 *
 * **It notices the resume link.** `?resume=` in the URL means this buyer came
 * back through the recovery email, and that is what separates `recovered` from
 * `finalized` — the difference between a metric and a flattering number. The
 * flag is reported to the server, which decides; it is not trusted, because
 * the session's own status is what actually qualifies it and only the cron can
 * set that.
 *
 * Every refusal is `null`. A shop that does not exist, a rate limit and a
 * cache outage read identically here, which is what stops this from telling
 * anybody anything about a shop.
 */

/** How long to wait after the last keystroke before writing the address down. */
const DEBOUNCE_MS = 1_200;

export type CheckoutSessionState = {
  sessionId: string | null;
  /** True when this checkout was opened from a recovery email's link. */
  viaResumeLink: boolean;
};

export function useCheckoutSession(input: {
  shopId: string;
  productId?: string | null;
  email: string;
}): CheckoutSessionState {
  const params = useSearchParams();
  const viaResumeLink = Boolean(params?.get("resume"));

  const [sessionId, setSessionId] = useState<string | null>(null);
  /*
   * What was last written, so a re-render with the same address does not write
   * again. A ref rather than state: changing it must not re-run the effect
   * that sets it, which is the loop this shape exists to avoid.
   */
  const written = useRef<string | null>(null);

  useEffect(() => {
    const email = input.email.trim().toLowerCase();
    // Only once there is something plausible to send to, or on the first open.
    const looksLikeAddress = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const payload = looksLikeAddress ? email : "";
    if (written.current === payload) return;

    const timer = setTimeout(() => {
      written.current = payload;
      void recordCheckoutOpened({
        shopId: input.shopId,
        productId: input.productId ?? null,
        email: payload || null,
      })
        .then((state) => {
          if (state.sessionId) setSessionId(state.sessionId);
        })
        /*
         * Swallowed on purpose, and this is the whole disposition of the
         * feature: a buyer is in the middle of checking out, and nothing about
         * *recording* that may be allowed to interrupt it. A failure here
         * costs the seller a follow-up; a thrown error would cost them a sale.
         */
        .catch(() => {});
    }, written.current === null ? 0 : DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [input.shopId, input.productId, input.email]);

  return { sessionId, viaResumeLink };
}
