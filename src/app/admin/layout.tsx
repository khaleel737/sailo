import { Sidebar } from "@/app/admin/_components/sidebar";
import {
  AdminHeader,
  AdminHeaderCompact,
} from "@/app/admin/_components/admin-header";
import { getDashboardStats } from "@/lib/queries";
import { getNotifications } from "@/lib/notifications";
import { isStaff, requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { AdminI18nProvider } from "@/app/admin/_components/admin-i18n";
import { StatusBanners } from "@/app/admin/_components/status-banners";
import { PanelFooter } from "@/components/shared/panel-footer";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { shop } = await requireShop();
  const { locale, t, a, dir } = await getAdminT();

  const [stats, all, staff] = await Promise.all([
    getDashboardStats(shop.id),
    getNotifications(shop.id, shop.notificationsReadAt, t),
    isStaff(),
  ]);

  const dismissed = new Set(shop.dismissedNotifications);
  const notifications = all.filter((n) => !dismissed.has(n.id));

  return (
    <AdminI18nProvider value={a}>
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
          <StatusBanners shop={shop} isStaff={staff} />
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
      </div>
    </AdminI18nProvider>
  );
}
