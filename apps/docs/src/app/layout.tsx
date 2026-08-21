import type { Metadata } from "next";
import { Footer, Layout, Navbar } from "nextra-theme-docs";
import { Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import { appOrigin } from "@sailo/core/origin";
import { docsOrigin } from "@/lib/origins";
import { Wordmark } from "@/components/wordmark";
import "nextra-theme-docs/style.css";
import "./reference.css";

/**
 * The shell every documentation page is rendered inside.
 *
 * `getPageMap()` walks `content/` at build time and is what the sidebar, the
 * breadcrumb and the previous/next links are built from — which is why the
 * navigation on this site cannot disagree with the pages that exist. A page
 * added to `content/` appears in the sidebar without anybody editing a list;
 * a page deleted takes its link with it.
 */

export const metadata: Metadata = {
  metadataBase: new URL(docsOrigin()),
  title: {
    default: "Sailo for developers",
    /*
     * The suffix, not a prefix. A search result and a browser tab both truncate
     * from the right, so the page's own name has to come first — "Webhooks —
     * Sailo" survives truncation in a way "Sailo — Webhooks" does not.
     */
    template: "%s — Sailo docs",
  },
  description:
    "The REST API, webhooks and MCP server behind a Sailo shop. One key opens all three.",
  applicationName: "Sailo",
  openGraph: {
    siteName: "Sailo for developers",
    type: "website",
    url: docsOrigin(),
  },
  twitter: { card: "summary" },
  /*
   * The same mark the product's tab shows, copied from apps/web's brand
   * directory rather than referenced across origins — a favicon fetched from
   * another host is a request some browsers refuse. The SVG is the icon; the
   * PNG is the fallback for the contexts that still rasterise one.
   */
  icons: {
    icon: [
      { url: "/brand/sailo-mark.svg", type: "image/svg+xml" },
      { url: "/brand/sailo-mark-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: "/brand/sailo-mark-512.png",
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pageMap = await getPageMap();

  return (
    /*
     * `suppressHydrationWarning` is next-themes' requirement, not a papering
     * over of a real mismatch: the theme script writes a class onto <html>
     * before React hydrates, precisely so a reader who chose dark does not get
     * a white flash first. React would otherwise report that write as a
     * hydration difference on every load.
     */
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head
        /*
         * The accent, used for links, the active sidebar item and the focus
         * ring. Sailo's brand green — `#037740` is hsl(152, 95%, 24%) — with
         * the lightness split per scheme: the brand value is link-legible on
         * white but vanishes on near-black, so dark mode gets the same hue
         * lifted rather than a different colour. Set here rather than left at
         * Nextra's blue default so the docs read as the same product as the
         * app they document.
         */
        color={{ hue: 152, saturation: 90, lightness: { light: 30, dark: 62 } }}
        /*
         * Pure white and near-black rather than the theme's default off-white
         * and charcoal. This site is almost entirely text and tables, and the
         * generated reference draws its own hairlines — a tinted page ground
         * under those reads as a slightly dirty screen rather than as warmth.
         */
        backgroundColor={{ light: "rgb(255,255,255)", dark: "rgb(10,10,10)" }}
      />
      <body>
        <Layout
          pageMap={pageMap}
          navbar={
            <Navbar
              logo={<Logo />}
              /*
               * Back to the product, from the logo. Somebody who arrived here
               * from a search result has no other route to it, and a
               * documentation site with no way out is one people leave rather
               * than one they read.
               */
              logoLink={appOrigin()}
            >
              <a className="x:text-sm x:hover:opacity-80" href={`${appOrigin()}/pricing`}>
                Pricing
              </a>
              <a className="x:text-sm x:hover:opacity-80" href={`${appOrigin()}/admin/settings/integrations`}>
                Get a key
              </a>
            </Navbar>
          }
          /*
           * No `docsRepositoryBase`, and so no "Edit this page" link. The theme
           * defaults it to Nextra's own repository, which would send a reader
           * to file a pull request against somebody else's project. Sailo's is
           * private, so there is nowhere honest to point it.
           */
          editLink={null}
          feedback={{ content: null }}
          footer={<Footer>© {new Date().getFullYear()} Sailo</Footer>}
          /*
           * Three levels of nesting at most, and the top level is short. Nothing
           * here benefits from collapsing a group the reader has to open to
           * discover the page they came for.
           */
          sidebar={{ defaultMenuCollapseLevel: 2, toggleButton: true }}
          toc={{ backToTop: "Back to top" }}
          darkMode
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}

/**
 * Wordmark plus the audience.
 *
 * The real wordmark now rather than the name set in the theme's font — the one
 * asset a reader has already seen on the storefront and the admin, which is
 * what makes the two sites read as one product. Its colour is
 * `reference.css`'s job: brand green in light, white in dark, matching the two
 * files apps/web ships.
 *
 * "Developers" rather than "Docs" because this site is not the only
 * documentation Sailo has — sellers have help articles in the product — and the
 * distinction is what tells a reader within a second whether they are in the
 * right place.
 */
function Logo() {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <span className="sailo-wordmark" style={{ display: "flex" }}>
        <Wordmark height={20} />
      </span>
      <span style={{ fontSize: "0.8125rem", opacity: 0.6 }}>Developers</span>
    </span>
  );
}
