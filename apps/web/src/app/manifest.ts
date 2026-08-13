import type { MetadataRoute } from "next";
import { getLocale } from "@/i18n/server";
import { directionOf } from "@sailo/i18n/config";
import { getMarketingDictionary } from "@sailo/i18n/marketing";

/**
 * Sellers run this from a phone, usually a cheap one, and a good number of
 * them will add it to a home screen.
 *
 * `standalone` and a start URL of `/admin` mean it opens on the orders list
 * rather than the marketing page. Whoever installs this to a home screen is
 * running a shop from it, and sending them to the landing page first would
 * cost them a tap on every single use to save one person a login they were
 * going to need anyway.
 *
 * `id` is set explicitly, and this is the reason to care: with no `id` a
 * browser derives the app's identity from `start_url`, so changing that URL
 * silently makes it a *different* app — an existing install stops updating and
 * a reinstall lands beside it. Pinned here, the identity survives the next
 * time somebody wants the app to open somewhere else.
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
    id: "/",
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
