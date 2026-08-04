import { Sidebar } from "@/components/admin/sidebar";
import { AdminHeader } from "@/components/admin/admin-header";
import { getDashboardStats } from "@/lib/queries";
import { getNotifications } from "@/lib/notifications";
import { requireShop } from "@/lib/session";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { shop } = await requireShop();

  const [stats, all] = await Promise.all([
    getDashboardStats(shop.id),
    getNotifications(shop.id, shop.notificationsReadAt),
  ]);

  const dismissed = new Set(shop.dismissedNotifications);
  const notifications = all.filter((n) => !dismissed.has(n.id));

  return (
    <div className="flex min-h-screen flex-col bg-ink-50 lg:flex-row">
      <Sidebar
        shopName={shop.name}
        handle={shop.handle}
        pendingReviews={stats.pendingReviews}
        newOrders={stats.newOrders}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminHeader shop={shop} notifications={notifications} />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
