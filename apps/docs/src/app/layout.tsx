import type { Metadata } from "next";
import { Footer, Layout, Navbar } from "nextra-theme-docs";
import { Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import { appOrigin } from "@sailo/core/origin";
import { docsOrigin } from "@/lib/origins";
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
         * ring. Set here rather than left at Nextra's default so the docs read
         * as the same product as the app they document.
         */
        color={{ hue: 212, saturation: 90, lightness: { light: 45, dark: 65 } }}
        /*
         * Pure white and near-black rather than the theme's default off-white
         * and charcoal. This site is almost entirely text and tables, and the
         * generated reference draws its own hairlines — a tinted page ground
         * under those reads as a slightly dirty screen rather than as warmth.
         */
        backgroundColor={{ light: "rgb(255,255,255)", dark: "rgb(10,10,10)" }}
        faviconGlyph="⚓"
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
 * "Developers" rather than "Docs" because this site is not the only
 * documentation Sailo has — sellers have help articles in the product — and the
 * distinction is what tells a reader within a second whether they are in the
 * right place.
 */
function Logo() {
  return (
    <span style={{ display: "flex", alignItems: "baseline", gap: "0.4rem" }}>
      <strong style={{ fontSize: "1.0625rem", letterSpacing: "-0.01em" }}>Sailo</strong>
      <span style={{ fontSize: "0.8125rem", opacity: 0.6 }}>Developers</span>
    </span>
  );
}
