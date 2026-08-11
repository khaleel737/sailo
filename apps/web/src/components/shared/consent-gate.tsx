import { getT } from "@/i18n/server";
import { measurementId } from "@/lib/google-tag";
import { CookieConsent } from "./cookie-consent";

/**
 * Asks for analytics consent, in the visitor's language, on Sailo's own pages.
 *
 * Mounted beside `<GoogleTag />` and nowhere else. Storefronts do not get it:
 * nothing of ours stores anything on a device there, so this banner would be
 * us taxing a seller's conversion rate for a tag that is not even loaded on
 * their page. A seller who connects their own marketing tags gets the
 * storefront's own request instead — `shop-consent.tsx` under `[handle]`,
 * asking about the seller's tools, per shop.
 *
 * Renders nothing when there is no measurement id — on a laptop, or on a
 * preview branch, there is no tag to consent to, and asking anyway would train
 * the one person who sees it to dismiss the thing without reading it.
 */
export async function ConsentGate() {
  if (!measurementId()) return null;

  const { t } = await getT();

  return (
    <CookieConsent
      labels={{
        title: t.consent.title,
        body: t.consent.body,
        accept: t.consent.accept,
        decline: t.consent.decline,
        privacy: t.consent.privacy,
        customise: t.consent.customise,
        save: t.consent.save,
        essential: t.consent.essential,
        essentialBody: t.consent.essentialBody,
        analytics: t.consent.analytics,
        analyticsBody: t.consent.analyticsBody,
      }}
    />
  );
}
