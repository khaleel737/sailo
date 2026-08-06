import { GoogleAnalytics } from "@next/third-parties/google";

/* ===========================================================================
   Sailo's own analytics — the Google tag

   Named `google-tag`, not `analytics`, because `src/lib/analytics.ts` is
   already taken by something unrelated: the seller's traffic classification
   that fills their dashboard. Two files one letter apart resolve to the `.ts`
   one, so an `analytics.tsx` here silently shadowed that module and broke an
   import in `traffic-panel` that had nothing to do with this feature.

   One place that knows the measurement id, one component that loads it, and
   one rule about where it may go. `@next/third-parties` is Vercel's package,
   pinned to the same version as Next itself, so the script strategy and the
   route-change pageviews are handled rather than hand-rolled.

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
 * The Google tag, for one Sailo-owned surface.
 *
 * Renders nothing when `NEXT_PUBLIC_GA_ID` is unset, which is the case in
 * development unless someone opts in on purpose.
 */
export function GoogleTag() {
  const id = measurementId();
  if (!id) return null;
  return <GoogleAnalytics gaId={id} />;
}
