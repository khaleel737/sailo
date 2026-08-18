import { GoogleTag } from "@/lib/google-tag";
import { ConsentGate } from "@/components/shared/consent-gate";
import { Sidebar } from "@/app/admin/_components/sidebar";
import {
  AdminHeader,
  AdminHeaderCompact,
} from "@/app/admin/_components/admin-header";
import { getDashboardStats } from "@/lib/queries";
import { getNotifications } from "@sailo/notifications/feed";
import { isStaff, requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { AdminI18nProvider } from "@/app/admin/_components/admin-i18n";
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
  const { user, shop } = await requireShop();
  const { locale, t, a, dir } = await getAdminT();

  const [stats, all, staff] = await Promise.all([
    getDashboardStats(shop.id),
    getNotifications(shop.id, shop.notificationsReadAt, t),
    isStaff(),
  ]);

  const dismissed = new Set(shop.dismissedNotifications);
  const notifications = all.filter((n) => !dismissed.has(n.id));

  return (
    <AdminI18nProvider value={a} locale={locale}>
      <div
        dir={dir}
        lang={locale}
        className="flex min-h-screen flex-col bg-ink-950 lg:flex-row"
      >
        <Sidebar
          shopName={shop.name}
          handle={shop.handle}
          pendingReviews={stats.pendingReviews}
          newOrders={stats.newOrders}
          docsUrl={docsUrl()}
          actions={
            <AdminHeaderCompact
              shop={shop}
              notifications={notifications}
              locale={locale}
              t={t}
            />
          }
          t={t}
        />
        <div className="flex min-w-0 flex-1 flex-col bg-ink-50">
          <StatusBanners
            shop={shop}
            isStaff={staff}
            unverifiedEmail={user.emailVerified ? null : user.email}
          />
          <AdminHeader
            shop={shop}
            notifications={notifications}
            locale={locale}
            t={t}
          />
          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <div className="animate-fade mx-auto w-full max-w-6xl">
              {children}
            </div>
          </main>
          <PanelFooter labels={a.shell} />
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
    </AdminI18nProvider>
  );
}
