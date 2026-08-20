import { GoogleTag } from "@/lib/google-tag";
import { ConsentGate } from "@/components/shared/consent-gate";
import { Sidebar } from "@/app/admin/_components/sidebar";
import { Topbar } from "@/app/admin/_components/topbar";
import type { PaletteEntry } from "@/app/admin/_components/command-palette";
import { getDashboardStats } from "@/lib/queries";
import { getNotifications } from "@sailo/notifications/feed";
import { isStaff, requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { AdminI18nProvider } from "@/app/admin/_components/admin-i18n";
import { SaveBarProvider } from "@/app/admin/_components/save-bar";
import { StatusBanners } from "@/app/admin/_components/status-banners";
import { PanelFooter } from "@/components/shared/panel-footer";
import { LiveRefresh } from "@sailo/design-system/web";
import { docsUrl } from "@sailo/core/origin";

/*
 * Per-seller, behind a session, and re-read on every visit — there is no
 * shared shell worth extracting here. `instant = false` says so explicitly
 * rather than leaving the build to complain about it.
 */
export const instant = false;

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { user, shop } = await requireShop("orders:read");
  const { locale, t, a, dir } = await getAdminT();

  const [stats, all, staff] = await Promise.all([
    getDashboardStats(shop.id),
    getNotifications(shop.id, shop.notificationsReadAt, t),
    isStaff(),
  ]);

  const dismissed = new Set(shop.dismissedNotifications);
  const notifications = all.filter((n) => !dismissed.has(n.id));
  const docs = docsUrl();

  /*
   * Everything ⌘K can reach, named by the same dictionaries the rail reads —
   * built here because the palette is a client component and labels are
   * server truth. Pages first, then the verbs a seller reaches for between
   * pages. Plain strings on purpose: this crosses the serialization line.
   */
  const entries: PaletteEntry[] = [
    { label: t.nav.overview, href: "/admin", group: "pages" },
    { label: t.nav.orders, href: "/admin/orders", group: "pages" },
    { label: t.nav.checkin, href: "/admin/checkin", group: "pages" },
    { label: t.nav.abandoned, href: "/admin/abandoned", group: "pages" },
    { label: t.nav.products, href: "/admin/products", group: "pages" },
    { label: t.nav.categories, href: "/admin/categories", group: "pages" },
    { label: t.nav.reviews, href: "/admin/reviews", group: "pages" },
    { label: t.nav.clients, href: "/admin/clients", group: "pages" },
    /* Labelled from the admin dictionary — see the sidebar's note on why. */
    { label: a.navGroups.analytics, href: "/admin/analytics", group: "pages" },
    { label: t.nav.members, href: "/admin/members", group: "pages" },
    { label: t.nav.testimonials, href: "/admin/testimonials", group: "pages" },
    { label: t.nav.broadcasts, href: "/admin/broadcasts", group: "pages" },
    { label: t.nav.flows, href: "/admin/flows", group: "pages" },
    { label: t.nav.coupons, href: "/admin/coupons", group: "pages" },
    { label: t.nav.affiliates, href: "/admin/affiliates", group: "pages" },
    { label: t.nav.payments, href: "/admin/payments", group: "pages" },
    { label: t.nav.delivery, href: "/admin/delivery", group: "pages" },
    { label: t.nav.dataRequests, href: "/admin/data-requests", group: "pages" },
    { label: t.nav.settings, href: "/admin/settings", group: "pages" },
    ...(
      [
        [a.settings.tabBilling, "/admin/settings/billing"],
        [a.settings.appearance, "/admin/settings/appearance"],
        [a.settings.tabAnalytics, "/admin/settings/analytics"],
        [a.tax.title, "/admin/settings/tax"],
        [a.settings.tabTeam, "/admin/settings/team"],
        [a.productForm.staffTitle, "/admin/settings/staff"],
        [a.integrations.title, "/admin/settings/integrations"],
        [a.broadcasts.fieldsTitle, "/admin/settings/fields"],
        [a.settings.notifications, "/admin/settings/notifications"],
        [a.legal.title, "/admin/settings/legal"],
        [a.settings.tabSecurity, "/admin/settings/security"],
        [a.settings.tabData, "/admin/settings/data"],
      ] as const
    ).map(([label, href]) => ({
      label: `${t.nav.settings} · ${label}`,
      href,
      group: "pages" as const,
    })),
    { label: a.support.helpLabel, href: "/admin/support", group: "pages" },

    { label: a.products.add, href: "/admin/products/new", group: "actions" },
    { label: a.broadcasts.compose, href: "/admin/broadcasts/new", group: "actions" },
    { label: a.flows.create, href: "/admin/flows/new", group: "actions" },
    { label: t.nav.viewShop, href: `/${shop.handle}`, group: "actions", external: true },
    { label: a.shell.docs, href: docs, group: "actions", external: true },
  ];

  const nav = {
    pendingReviews: stats.pendingReviews,
    newOrders: stats.newOrders,
    t,
  };

  return (
    <AdminI18nProvider value={a} locale={locale}>
      <SaveBarProvider>
      <div dir={dir} lang={locale} className="flex min-h-screen flex-col bg-ink-50">
        <Topbar
          shop={shop}
          notifications={notifications}
          locale={locale}
          t={t}
          docsUrl={docs}
          entries={entries}
          nav={nav}
        />

        <div className="flex flex-1">
          <Sidebar {...nav} />

          <div className="flex min-w-0 flex-1 flex-col">
            <StatusBanners
              shop={shop}
              isStaff={staff}
              unverifiedEmail={user.emailVerified ? null : user.email}
            />
            <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
              <div className="animate-fade mx-auto w-full max-w-6xl">
                {children}
              </div>
            </main>
            <PanelFooter labels={a.shell} />
          </div>
        </div>

        {/*
          The panel re-renders itself when the shop changes under it — a
          webhook settling an order, a storefront visit landing. In the
          layout rather than a page so every /admin screen, badges and bell
          included, is live for the price of one stream per tab.
        */}
        <LiveRefresh url="/api/admin/events" />
        <GoogleTag />
        <ConsentGate />
      </div>
      </SaveBarProvider>
    </AdminI18nProvider>
  );
}
