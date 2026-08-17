/**
 * The landing page's `<head>`, for whichever of the 35 URLs is being served.
 *
 * Its own module because it is a different job from rendering the page: it emits no markup and
 * reads no dictionary content, only the locale and the URL cluster. Keeping it beside the view
 * meant every edit to a marketing section touched the file that decides what Google indexes.
 *
 * Self-canonical and carrying the full `hreflang` cluster. Both matter more here than anywhere
 * else on the site: these are the same page in 35 languages, so without the cluster Google
 * indexes whichever it crawled first and serves that one to everybody — which is how a French
 * seller searching in French gets offered the English page, if they are offered anything.
 *
 * `alternateLocale` is the same fact in the vocabulary a social scraper reads;
 * `alternates.languages` is crawlers only.
 */

import type { Metadata } from "next";
import { getMarketingDictionary } from "@sailo/i18n/marketing";
import { LOCALES, type Locale } from "@sailo/i18n/config";
import { homeLanguages, homePath, marketingUrl } from "@/lib/marketing-urls";


/**
 * The landing page's `<head>`, for whichever of the 35 URLs is being served.
 *
 * Self-canonical and carrying the full `hreflang` cluster. Both matter more
 * here than anywhere else on the site: these are the same page in 35 languages,
 * so without the cluster Google indexes whichever it crawled first and serves
 * that one to everybody — which is how a French seller searching in French
 * gets offered the English page, if they are offered anything.
 *
 * `alternateLocale` is the same fact in the vocabulary a social scraper reads;
 * `alternates.languages` is crawlers only.
 */
export function homeMetadata(locale: Locale): Metadata {
  const m = getMarketingDictionary(locale);
  const path = homePath(locale);

  return {
    /*
     * `absolute` so the root layout's "%s · Sailo" template does not run.
     *
     * `seo.title` already ends in the brand — it is written as a complete title
     * tag, keyword first and "— Sailo" last, because that is the order that
     * wins when nobody searches your name yet. Letting the template append to
     * it shipped "Take orders online without a website — Sailo · Sailo", which
     * is the sort of thing that only ever shows up in the served HTML. It was
     * invisible before this rewrite because the root layout set it as
     * `title.default`, and a default is not passed through the template.
     */
    title: { absolute: m.seo.title },
    description: m.seo.description,
    /*
     * Moved down from the root layout, where it was inherited by every
     * storefront and described Sailo on a page that belongs to a seller.
     *
     * Google has ignored the tag since 2009, so this is not a ranking lever —
     * it is a statement of which category we are in, for smaller engines and
     * the crawlers that summarise pages. Led by the job rather than the thing:
     * a seller searches for how to take an order, not for a category of
     * software. "Link in bio" is absent deliberately — it is Linktree's term,
     * unwinnable on a domain with no authority, and it files us beside creator
     * tools that ship no catalogue and are not who we lose deals to.
     */
    keywords: [
      "take orders online",
      "sell online without a website",
      "online order form for small business",
      "take orders on Instagram",
      "sell on WhatsApp",
      "custom order form",
      "take deposits online",
      "online store for small business",
      "Etsy alternative",
      "low fee ecommerce",
    ],
    alternates: { canonical: path, languages: homeLanguages() },
    openGraph: {
      type: "website",
      title: m.seo.ogTitle,
      description: m.seo.ogDescription,
      url: marketingUrl(path),
      locale,
      alternateLocale: LOCALES.map(({ code }) => code).filter((c) => c !== locale),
    },
    twitter: {
      card: "summary_large_image",
      title: m.seo.ogTitle,
      description: m.seo.ogDescription,
    },
  };
}
