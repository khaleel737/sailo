import type { MetadataRoute } from "next";
import { getLocale } from "@/i18n/server";
import { directionOf } from "@sailo/i18n/config";
import { getMarketingDictionary } from "@sailo/i18n/marketing";

/**
 * Sellers run this from a phone, usually a cheap one, and a good number of
 * them will add it to a home screen.
 *
 * It opens on the site, not on `/admin`. A start URL behind a login is only
 * right if every person who installs the app already has an account, and that
 * is not who reaches this domain: a buyer following a shop link gets the same
 * install prompt, and a start URL of `/admin` hands them a password field as
 * the first thing the app ever shows them. Sellers lose one tap; the wrong
 * audience loses the whole first impression, so the site wins.
 *
 * The seller's lost tap is worth giving back with `shortcuts`, so a long press
 * on the icon opens the dashboard directly. Not added yet: the labels would be
 * the only untranslated strings in a product that ships twenty-odd locales,
 * and two English words in the app launcher is the kind of thing that reads as
 * neglect. Add them with the dictionary entries, not before.
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
    start_url: "/",
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
