"use client";

import { useEffect, useState } from "react";
import { GoogleAnalytics } from "@next/third-parties/google";
import { CONSENT_EVENT, hasAnalyticsConsent } from "@/lib/consent";

/**
 * Loads the Google tag only once the visitor has agreed to it.
 *
 * Not Google Consent Mode. Consent Mode keeps `gtag.js` on the page and asks
 * it to behave, which still fetches the script and still pings Google from
 * every visitor who declined. Not loading it at all is simpler to reason
 * about, impossible to get subtly wrong, and it is what "no analytics cookies
 * before consent" actually means.
 *
 * The tag therefore starts after hydration and after a click, so the first
 * pageview of a consenting visitor's first session is not measured. That is a
 * real cost, it is the honest one to pay, and it is why the preconnect hints
 * in `google-tag.tsx` exist — the handshake is warm by the time this mounts.
 */
export function GoogleTagGate({ gaId }: { gaId: string }) {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const sync = () => setAllowed(hasAnalyticsConsent());
    sync();
    window.addEventListener(CONSENT_EVENT, sync);
    // Answering in another tab starts the tag here too.
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CONSENT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (!allowed) return null;
  return <GoogleAnalytics gaId={gaId} />;
}
