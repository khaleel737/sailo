"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";
import { preconnect, prefetchDNS } from "react-dom";
import { GoogleAnalytics, GoogleTagManager } from "@next/third-parties/google";
import { SHOP_CONSENT_EVENT, hasShopMarketingConsent } from "@sailo/customers/shop-consent";
import type { ShopPixelIds } from "@sailo/customers/pixels";

/**
 * The seller's tags, loaded only once this buyer has agreed — on this shop.
 *
 * Same construction as `google-tag-gate.tsx`, and not a consent-mode variant,
 * for the same reason: consent mode keeps the script on the page and asks it
 * to behave, which still fetches it and still pings the vendor from a buyer
 * who declined. Not loading it at all is what "nothing before consent"
 * actually means. The cost is the same honest one — the first pageview of a
 * consenting buyer's first visit is not measured — and the connection hints
 * below are what keep that gap from also costing a cold handshake.
 *
 * The ids arriving here were shape-checked twice (`lib/shop-pixels.ts`), so
 * they can only be identifiers. They are still dropped into the inline
 * bootstraps through `JSON.stringify`, because a template that is safe by
 * construction beats one that is safe by the argument three files away.
 */
export function ShopPixels({
  shopId,
  pixels,
}: {
  shopId: string;
  pixels: ShopPixelIds;
}) {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const sync = () => setAllowed(hasShopMarketingConsent(shopId));
    sync();
    window.addEventListener(SHOP_CONSENT_EVENT, sync);
    // Answering in another tab of the same shop counts here too.
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SHOP_CONSENT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [shopId]);

  /*
   * Warmed while the banner is still up, so a "yes" starts measuring in one
   * round trip instead of three. A handshake moves no bytes and stores
   * nothing — the same trade `google-tag.tsx` documents.
   */
  if (pixels.ga4 || pixels.gtm) {
    preconnect("https://www.googletagmanager.com");
    prefetchDNS("https://www.google-analytics.com");
    prefetchDNS("https://region1.google-analytics.com");
  }
  if (pixels.meta) {
    preconnect("https://connect.facebook.net");
    prefetchDNS("https://www.facebook.com");
  }
  if (pixels.tiktok) preconnect("https://analytics.tiktok.com");

  if (!allowed) return null;

  return (
    <>
      {pixels.ga4 ? <GoogleAnalytics gaId={pixels.ga4} /> : null}
      {pixels.gtm ? <GoogleTagManager gtmId={pixels.gtm} /> : null}
      {pixels.meta ? <MetaPixel id={pixels.meta} /> : null}
      {pixels.tiktok ? <TikTokPixel id={pixels.tiktok} /> : null}
    </>
  );
}

/*
 * Meta and TikTok have no `@next/third-parties` component, so their standard
 * bootstraps are inlined here and route changes are reported by the hook
 * below — the piece the Google components otherwise handle for free.
 */

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    ttq?: { page: () => void };
  }
}

/**
 * Reports SPA navigations, skipping the pageview the bootstrap already sent.
 * A storefront has real ones — catalogue to product page and back — and a
 * pixel that only saw the landing page would tell the seller every visitor
 * bounced.
 */
function usePageViews(report: () => void) {
  const pathname = usePathname();
  const landed = useRef(false);
  const reportRef = useRef(report);
  reportRef.current = report;

  useEffect(() => {
    if (!landed.current) {
      landed.current = true;
      return;
    }
    reportRef.current();
  }, [pathname]);
}

function MetaPixel({ id }: { id: string }) {
  usePageViews(() => window.fbq?.("track", "PageView"));

  return (
    <Script
      id="sailo-meta-pixel"
      dangerouslySetInnerHTML={{
        __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${JSON.stringify(id)});fbq('track','PageView');`,
      }}
    />
  );
}

function TikTokPixel({ id }: { id: string }) {
  usePageViews(() => window.ttq?.page());

  return (
    <Script
      id="sailo-tiktok-pixel"
      dangerouslySetInnerHTML={{
        __html: `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=r;ttq._t=ttq._t||{};ttq._t[e]=+new Date;ttq._o=ttq._o||{};ttq._o[e]=n||{};n=d.createElement("script");n.type="text/javascript";n.async=!0;n.src=r+"?sdkid="+e+"&lib="+t;e=d.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};ttq.load(${JSON.stringify(id)});ttq.page();}(window,document,'ttq');`,
      }}
    />
  );
}
