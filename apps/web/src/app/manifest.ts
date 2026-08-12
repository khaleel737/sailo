import type { MetadataRoute } from "next";
import { getLocale } from "@/i18n/server";
import { directionOf } from "@sailo/i18n/config";
import { getMarketingDictionary } from "@sailo/i18n/marketing";

/**
 * Sellers run this from a phone, usually a cheap one, and a good number of
 * them will add it to a home screen. `standalone` and a start URL of `/admin`
 * mean it opens on the orders list rather than the marketing page.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const locale = await getLocale();
  const m = getMarketingDictionary(locale);

  return {
    name: `Sailo — ${m.footer.tagline}`,
    short_name: "Sailo",
    description: m.seo.description,
    lang: locale,
    dir: directionOf(locale),
    start_url: "/admin",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#037740",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/brand/sailo-mark-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/brand/sailo-mark-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
