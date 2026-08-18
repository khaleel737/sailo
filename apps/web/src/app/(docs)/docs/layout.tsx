import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { source } from "@/lib/docs-source";
import { SailoLogo } from "@/components/brand";

/**
 * The docs shell — sidebar, search, breadcrumb, table of contents.
 *
 * Its own route group rather than `(marketing)`, because Fumadocs owns the
 * whole page: it renders a sidebar down the left and a table of contents down
 * the right, and nesting that inside the marketing header and footer would put
 * two navigations on screen disagreeing about where the reader is. The URL is
 * unaffected — `(docs)` is a route group, so these pages are still `/docs/…`.
 *
 * The way back to the site is the logo in the sidebar, which links to `/`
 * rather than to `/docs`. Somebody who arrived here from a search result has no
 * other route to the product, and a docs site with no way out of it is one
 * people leave rather than one they read.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      nav={{
        title: (
          <span className="flex items-center gap-2">
            <SailoLogo className="h-4 w-auto" />
            <span className="text-sm font-medium">Developers</span>
          </span>
        ),
        url: "/",
      }}
      links={[
        { text: "Pricing", url: "/pricing" },
        { text: "Blog", url: "/blog" },
        { text: "API keys", url: "/admin/settings/integrations" },
      ]}
    >
      {children}
    </DocsLayout>
  );
}
