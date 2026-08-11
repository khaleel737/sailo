import { Analytics } from "@vercel/analytics/next";

/* ===========================================================================
   Vercel Web Analytics

   The second tag in the app, and the one with the opposite placement rule to
   `google-tag.tsx`. Worth stating why, because "we already decided this for
   the Google tag" is the wrong instinct here.

   The Google tag is kept off seller storefronts because it sets cookies,
   carries an ad-tech lineage, and would make a third party's buyers legible to
   us with no consent flow. None of that is true of this one: it is cookieless,
   sets no persistent identifier, does no cross-site tracking, and reports in
   aggregate.

   More to the point, it collects nothing Sailo does not already have. Every
   storefront request is served by this deployment and already recorded by
   `VisitTracker` → `/api/track` to fill the seller's own dashboard. This adds
   Web Vitals and a traffic shape to requests we are already handling — and
   storefront performance is Sailo's problem to fix, since Sailo wrote the
   template. Measuring only our marketing pages would leave the slowest and
   most-visited surface in the product unmeasured.

   So this one mounts once, in the root layout, and covers everything.

   One consequence worth knowing: Vercel bills Web Analytics per event on most
   plans, and storefront traffic will dwarf marketing traffic. If the bill is a
   surprise, this is the reason, and the fix is to move this mount down into
   the same five layouts the Google tag uses.
=========================================================================== */

/**
 * Vercel Web Analytics, for every route this deployment serves.
 *
 * No configuration and no environment variable: the script resolves its
 * project from the deployment it is served by, and does nothing at all when
 * running outside Vercel — so a laptop reports nothing without needing a flag
 * to say so.
 */
export function VercelAnalytics() {
  return <Analytics />;
}
