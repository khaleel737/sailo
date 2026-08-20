import type { Metadata } from "next";
import { requireShop } from "@/lib/session";
import { shopPagesFor } from "@sailo/commerce/pages";
import { analyticsPreanswer } from "@sailo/core/shop-pages";
import { getAdminT } from "@/i18n/server";
import { LegalPagesScreen } from "./_components/legal-pages-screen";

export const metadata: Metadata = { title: "Legal pages" };

/**
 * The seller's own documents. Spec 41.
 *
 * Its own screen rather than a card in Settings, and the reason is what it has
 * to hold: a five-page list with a publish state each, a markdown editor, a
 * regeneration diff and the checkout switch. Settings is already the longest
 * form in the product; a sixth accordion in it would be where this feature went
 * to be undiscovered.
 *
 * Read live, not cached. The public pages are cached under `shopTag` and the
 * admin must show what is actually stored — a seller who just saved a draft and
 * is shown the previous body would edit the wrong text.
 */
export default async function AdminLegalPagesPage() {
  const { shop } = await requireShop("settings:read");
  const [pages, { a }] = await Promise.all([shopPagesFor(shop.id), getAdminT()]);

  return (
    <>
      {/* The overlay's rail names this section; only the intro stays here. */}
      <p className="mb-5 -mt-3 max-w-prose text-sm leading-relaxed text-ink-500">
        {a.legal.intro}
      </p>
      <LegalPagesScreen
        pages={pages}
        handle={shop.handle}
        termsUrl={shop.termsUrl}
        privacyUrl={shop.privacyUrl}
        requireTerms={shop.requireTerms}
        /*
         * Derived, never asked. A seller who has configured a pixel has already
         * told us they measure; putting the question again invites the answer
         * that makes their privacy policy untrue.
         */
        usesAnalytics={analyticsPreanswer(shop)}
      />
    </>
  );
}
