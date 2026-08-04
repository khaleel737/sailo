import { Sidebar } from "@/components/admin/sidebar";
import { getDashboardStats } from "@/lib/queries";
import { requireShop } from "@/lib/session";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { shop } = await requireShop();
  const stats = await getDashboardStats(shop.id);

  return (
    <div className="flex min-h-screen flex-col bg-ink-50 lg:flex-row">
      <Sidebar
        shopName={shop.name}
        handle={shop.handle}
        pendingReviews={stats.pendingReviews}
        newOrders={stats.newOrders}
      />
      <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
