import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Outfit } from "next/font/google";
import { getLocale } from "@/i18n/server";
import { directionOf } from "@/i18n/config";
import { getMarketingDictionary } from "@/i18n/marketing";
import { APP_URL } from "@/lib/seo";
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
      "no commission ecommerce",
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
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    icons: {
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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Screen readers and search engines read the root element, so it carries the
  // visitor's resolved language. A shop whose own default differs overrides
  // both `lang` and `dir` on its own container.
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      dir={directionOf(locale)}
      className={`${geistSans.variable} ${geistMono.variable} ${outfit.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white text-ink-900">
        {children}
      </body>
    </html>
  );
}
