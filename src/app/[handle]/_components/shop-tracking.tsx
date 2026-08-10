import type { Shop } from "@/db/schema";
import type { Dictionary } from "@/i18n";
import { interpolate } from "@/i18n";
import { configuredPixels, pixelIdsOf } from "@/lib/shop-pixels";
import { ShopConsent } from "./shop-consent";
import { ShopPixels } from "./shop-pixels";

/**
 * A seller's tags and the consent request they require — one mount line per
 * storefront page, beside `VisitTracker`, following the house rule that a
 * surface is measured by a line of code you can grep for rather than by an
 * accident of nesting.
 *
 * Renders nothing for the overwhelming case of a shop with no tags
 * configured: no banner, no script, no change from the storefront as it has
 * always been. The moment a seller adds an id in settings, the question and
 * the (consent-gated) tags arrive together — neither ever exists without the
 * other, which is what keeps the banner truthful and the tags legal.
 */
export function ShopTracking({ shop, t }: { shop: Shop; t: Dictionary }) {
  const pixels = pixelIdsOf(shop);
  const tools = configuredPixels(pixels);
  if (tools.length === 0) return null;

  return (
    <>
      <ShopPixels shopId={shop.id} pixels={pixels} />
      <ShopConsent
        shopId={shop.id}
        labels={{
          title: t.consent.shopTitle,
          body: interpolate(t.consent.shopBody, { shop: shop.name }),
          accept: t.consent.accept,
          decline: t.consent.decline,
          privacy: t.consent.privacy,
          customise: t.consent.customise,
          save: t.consent.save,
          essential: t.consent.essential,
          essentialBody: t.consent.shopEssentialBody,
          marketing: t.consent.marketing,
          marketingBody: interpolate(t.consent.marketingBody, {
            shop: shop.name,
          }),
        }}
        /*
         * The tools by name, with the cookies each is known to write. Proper
         * nouns and identifiers read the same in every language, so the
         * checkable part of the disclosure needs no dictionary entry.
         */
        disclosure={tools.map((tool) =>
          tool.stored.length ? `${tool.name} (${tool.stored.join(", ")})` : tool.name,
        )}
      />
    </>
  );
}
