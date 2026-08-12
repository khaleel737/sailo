import { preconnect, prefetchDNS } from "react-dom";
import { GoogleTagGate } from "@/lib/google-tag-gate";

/* ===========================================================================
   Sailo's own analytics — the Google tag

   Named `google-tag`, not `analytics`, because `src/lib/analytics.ts` is
   already taken by something unrelated: the seller's traffic classification
   that fills their dashboard. Two files one letter apart resolve to the `.ts`
   one, so an `analytics.tsx` here silently shadowed that module and broke an
   import in `traffic-panel` that had nothing to do with this feature.

   One place that knows the ids, one component that loads them, and one rule
   about where they may go. `@next/third-parties` is Vercel's package, pinned
   to the same version as Next itself, so the script strategy and the
   route-change pageviews are handled rather than hand-rolled.

   Two tags ship from here: GA4, which measures, and a GTM container, which
   measures nothing on its own and exists to load tags configured outside this
   repository. They are deliberately siblings rather than nested — see
   `containerId()` for why GA4 is not configured inside the container.

   ---------------------------------------------------------------------------
   Where this may be mounted, and why it is not in the root layout

   The root layout wraps every route this app serves, and most of them are not
   ours. `/{handle}` is a seller's shop; the people on it are the seller's
   customers, not Sailo's visitors. Mounting a Sailo tag there would:

     1. send a third party's buyers to our property with no consent flow of
        any kind, in an app that ships 35 locales including the EU, where the
        seller — not us — is the controller of that data;
     2. drown the numbers this exists to answer. Signup funnels measured
        against every storefront pageview in the system are not measurable;
     3. duplicate work already done properly. Storefronts have `VisitTracker`
        → `/api/track`, which is what fills the seller's own dashboard.

   So the tag is mounted per surface, explicitly, in the layout of each part of
   the product Sailo actually owns. A layout that renders `<Analytics />` is
   measured; one that does not, is not. Grep tells you the answer, and adding
   a surface is a deliberate line of code rather than an accident of nesting.

   Mounted in:  (marketing) · (auth) · (legal) · onboarding · admin
   Deliberately absent from:
     /[handle] and everything under it   seller's shop, seller's buyers
     /download /invoice /partner          buyer-facing, reached by token
     /hq                                  internal staff, already noindex

   Storefronts can still carry tags — the *seller's* own, configured in
   settings and consent-gated per shop. That is `lib/shop-pixels.ts` and the
   `[handle]` components, and it reports to the seller's property, never ours.
=========================================================================== */

/**
 * The GA4 measurement id, or null when this deployment should not report.
 *
 * Read from the environment rather than baked in, so a preview branch and a
 * laptop do not post into the production property. Unset means the component
 * renders nothing at all — no script tag, no `dataLayer`, no request.
 */
export function measurementId(): string | null {
  const id = process.env.NEXT_PUBLIC_GA_ID?.trim();
  return id ? id : null;
}

/**
 * The GTM container id, or null when this deployment should not load one.
 *
 * Read from the environment for the same reason as the measurement id above:
 * a container baked into the bundle follows a branch into preview.
 *
 * Two things about this container are worth knowing before adding a tag to it,
 * because both fail quietly:
 *
 *   1. It cannot be used to add a vendor without a deploy, which is the usual
 *      reason to run GTM at all. `script-src` in `next.config.ts` is an
 *      allowlist, so a tag added in the GTM console that fetches from a host
 *      not named there is blocked by the browser — the page renders perfectly
 *      and the tag simply never runs. `googletagmanager.com`, Stripe, Meta and
 *      TikTok are allowed today; anything else is a change to that policy.
 *   2. A GA4 configuration tag must not be added to it. GA4 is already loaded
 *      directly, beside this container, by the component below. Configuring it
 *      here as well sends two `page_view` hits per navigation to the same
 *      property, which inflates every number built on them.
 */
export function containerId(): string | null {
  const id = process.env.NEXT_PUBLIC_GTM_ID?.trim();
  return id ? id : null;
}

/**
 * The Google tag, for one Sailo-owned surface.
 *
 * Renders nothing when `NEXT_PUBLIC_GA_ID` is unset, which is the case in
 * development unless someone opts in on purpose.
 *
 * The hints are the reason this is a component rather than one line inline.
 * `gtag.js` is fetched after hydration, so the page waits on a cold DNS
 * lookup, TCP handshake and TLS negotiation to a host it has never spoken to
 * — 300ms of it, measured. Warming the connection costs nothing on the
 * critical path because it moves no bytes; the script still starts when the
 * tag below decides to start it.
 *
 * Only the script host is preconnected. The collect endpoint is chosen by the
 * visitor's region at runtime — `region1` for the EEA, the bare host
 * elsewhere — so a full handshake to either one is a coin flip, and a wasted
 * preconnect holds a socket open for ten seconds. DNS alone is the part worth
 * paying for twice.
 */
export function GoogleTag() {
  const gaId = measurementId();
  const gtmId = containerId();
  if (!gaId && !gtmId) return null;

  // Both tags are served from the same script host, so the preconnect pays for
  // either. The collect endpoints are hinted whichever way GA4 arrives — the
  // container can carry tags that talk to them too.
  preconnect("https://www.googletagmanager.com");
  prefetchDNS("https://region1.google-analytics.com");
  prefetchDNS("https://www.google-analytics.com");

  // Gated: the scripts only load once the visitor has agreed. See
  // `google-tag-gate.tsx` for why this is not Consent Mode.
  return <GoogleTagGate gaId={gaId} gtmId={gtmId} />;
}
