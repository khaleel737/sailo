import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono, Outfit } from "next/font/google";
import { getLocale, getT } from "@/i18n/server";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { getMarketingDictionary } from "@/i18n/marketing";
import { RouteProgress } from "@/components/shared/route-progress";
import { ErrorStringsSource } from "@/components/shared/error-panel";
import { VercelAnalytics } from "@/lib/vercel-analytics";
import { APP_URL } from "@/lib/seo";
import { LANG_SCRIPT } from "@/i18n/lang-script";
import "./globals.css";
import "./brand.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Display face, marketing surface only.
 *
 * Geist is the better paragraph font and stays the body face everywhere. Outfit
 * is geometric and a touch wide, which is what lets a headline read expensive at
 * 6rem without shouting. Only the weights the landing page actually sets are
 * requested, so the extra face costs one small file.
 */
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

/**
 * Site-wide metadata.
 *
 * The title and description are read from the marketing dictionary in the
 * visitor's own language, because a crawler arriving with `Accept-Language: es`
 * should be offered the Spanish page it will actually get. `metadataBase` is
 * what turns every relative image and canonical below into an absolute URL —
 * without it, Open Graph tags ship as paths and no scraper resolves them.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const m = getMarketingDictionary(locale);

  return {
    metadataBase: new URL(APP_URL),
    title: {
      default: m.seo.title,
      template: "%s · Sailo",
    },
    description: m.seo.description,
    applicationName: "Sailo",
    keywords: [
      "link in bio shop",
      "sell on WhatsApp",
      "online store builder",
      "link in bio store",
      "sell digital downloads",
      "booking page",
      "Linktree alternative",
      "low fee ecommerce",
    ],
    /*
     * No `alternates.canonical` here on purpose.
     *
     * Metadata is inherited, so a canonical on the root layout is a canonical
     * on every page that does not set its own — /login and /signup were both
     * telling Google they *were* the homepage. The homepage declares its own
     * in `page.tsx`; anything else either sets one that fits or has none, and
     * a page with no canonical is simply itself.
     */
    openGraph: {
      type: "website",
      siteName: "Sailo",
      title: m.seo.ogTitle,
      description: m.seo.ogDescription,
      url: "/",
      locale,
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: m.seo.ogTitle,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: m.seo.ogTitle,
      description: m.seo.ogDescription,
      images: ["/opengraph-image"],
    },
    /*
     * Preview limits only — deliberately no `index: true`.
     *
     * A page with no robots meta is already indexable, so asserting it gained
     * nothing and cost the 404s. `notFound()` makes Next inject
     * `<meta name="robots" content="noindex">`, and because every dynamic
     * route here streams, the response has already committed to `200` before
     * the not-found renders — that tag is the only thing keeping a missing
     * shop out of the index. Declaring `index: true` at the root overrode it,
     * so every unknown handle, product and invoice token served a soft 404
     * that invited Google to index it.
     *
     * A page that must not be indexed still says so itself; see the invoice
     * and download routes.
     */
    robots: {
      googleBot: {
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    icons: {
      /*
       * Only the SVG is declared. `favicon.ico` sits in this folder and Next
       * emits its own tag for it with a content hash — which is what makes a
       * replaced icon actually replace the one in a browser's cache. Adding a
       * second, unhashed tag here only duplicates it and loses the hash.
       */
      icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
      apple: "/apple-icon.png",
    },
    manifest: "/manifest.webmanifest",
    /*
     * There was an `og:site` here. It is not an Open Graph property — the real
     * one is `og:site_name`, already emitted above from `openGraph.siteName` —
     * and Next rendered it as `<meta name=...>` rather than `<meta property=...>`,
     * so no scraper read it under either name. Removed rather than renamed: the
     * canonical origin it was trying to state is what `metadataBase` and the
     * absolute `og:url` already say.
     */
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0e0d" },
  ],
  colorScheme: "light",
};

/**
 * The chrome that needs to know the visitor's language.
 *
 * Split out and streamed so the layout itself awaits nothing. Both pieces are
 * siblings of the page rather than wrappers around it, which is what lets the
 * page beneath prerender — see `ErrorStringsSource` for the longer version of
 * why that distinction is the whole migration.
 */
async function LocalisedChrome() {
  const { t } = await getT();

  return (
    <>
      <RouteProgress label={t.common.loading} />
      <ErrorStringsSource value={t.errors} />
    </>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    /*
     * A static default, corrected by `LANG_SCRIPT` before the first paint.
     *
     * Reading the real locale here means reading a cookie, and a cookie read
     * on `<html>` has no child to stream — it makes every route in the product
     * request-bound. `suppressHydrationWarning` because the script changes
     * these two attributes before React hydrates, which is expected.
     */
    <html
      lang={DEFAULT_LOCALE}
      dir="ltr"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${outfit.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white text-ink-900">
        {/* First thing in the body, so it runs while the browser is still
            parsing and nothing has been painted. */}
        <script dangerouslySetInnerHTML={{ __html: LANG_SCRIPT }} />
        {/*
          Suspense because `RouteProgress` reads `useSearchParams` and the
          dictionary read is request-bound. Both stream; neither holds up the
          page.
        */}
        <Suspense fallback={null}>
          <LocalisedChrome />
        </Suspense>
        {children}
        {/*
          Cookieless and aggregate, so unlike the Google tag this one covers
          storefronts too — see `src/lib/vercel-analytics.tsx` for why the
          two tags deliberately have opposite placement rules.
        */}
        <VercelAnalytics />
      </body>
    </html>
  );
}
