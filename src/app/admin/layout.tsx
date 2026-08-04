import { Sidebar } from "@/components/admin/sidebar";
import { AdminHeader } from "@/components/admin/admin-header";
import { getDashboardStats } from "@/lib/queries";
import { getNotifications } from "@/lib/notifications";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { AdminI18nProvider } from "@/components/admin/admin-i18n";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { shop } = await requireShop();
  const { locale, t, a, dir } = await getAdminT();

  const [stats, all] = await Promise.all([
    getDashboardStats(shop.id),
    getNotifications(shop.id, shop.notificationsReadAt, t),
  ]);

  const dismissed = new Set(shop.dismissedNotifications);
  const notifications = all.filter((n) => !dismissed.has(n.id));

  return (
    <AdminI18nProvider value={a}>
    <div
      dir={dir}
      lang={locale}
      className="flex min-h-screen flex-col bg-ink-50 lg:flex-row"
    >
      <Sidebar
        shopName={shop.name}
        handle={shop.handle}
        pendingReviews={stats.pendingReviews}
        newOrders={stats.newOrders}
        t={t}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminHeader
          shop={shop}
          notifications={notifications}
          locale={locale}
          t={t}
        />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
    </AdminI18nProvider>
  );
}
