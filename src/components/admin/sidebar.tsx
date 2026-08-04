"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  CreditCard,
  ExternalLink,
  Gift,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Package,
  Settings,
  ShoppingBag,
  Store,
  Tag,
  Tags,
  Truck,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/products", label: "Products", icon: Package },
  { href: "/admin/categories", label: "Categories", icon: Tag },
  { href: "/admin/orders", label: "Orders", icon: ShoppingBag },
  { href: "/admin/clients", label: "Clients", icon: Users },
  { href: "/admin/reviews", label: "Reviews", icon: MessageSquare },
  { href: "/admin/coupons", label: "Coupons", icon: Tags },
  { href: "/admin/affiliates", label: "Affiliates", icon: Gift },
  { href: "/admin/payments", label: "Payments", icon: CreditCard },
  { href: "/admin/delivery", label: "Delivery", icon: Truck },
  { href: "/admin/billing", label: "Billing", icon: Wallet },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export function Sidebar({
  shopName,
  handle,
  pendingReviews,
  newOrders,
}: {
  shopName: string;
  handle: string;
  pendingReviews: number;
  newOrders: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function onSignOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5">
      {NAV.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);
        const badge =
          item.href === "/admin/reviews"
            ? pendingReviews
            : item.href === "/admin/orders"
              ? newOrders
              : 0;

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
              active
                ? "bg-ink-900 text-white"
                : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
            )}
          >
            <item.icon className="size-4 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {badge > 0 ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                  active ? "bg-white/20 text-white" : "bg-ink-900 text-white",
                )}
              >
                {badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="space-y-1 border-t border-ink-200 pt-3">
      <a
        href={`/${handle}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-600 transition hover:bg-ink-100 hover:text-ink-900"
      >
        <ExternalLink className="size-4" />
        View shop
      </a>
      <button
        type="button"
        onClick={onSignOut}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-600 transition hover:bg-ink-100 hover:text-ink-900"
      >
        <LogOut className="size-4" />
        Sign out
      </button>
    </div>
  );

  return (
    <>
      {/* Mobile bar */}
      <div className="flex items-center justify-between border-b border-ink-200 bg-white px-4 py-3 lg:hidden">
        <Link href="/admin" className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-ink-900 text-white">
            <Store className="size-4" />
          </span>
          <span className="text-sm font-semibold">{shopName}</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="rounded-lg p-2 text-ink-600 hover:bg-ink-100"
        >
          <Menu className="size-5" />
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-semibold">{shopName}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100"
              >
                <X className="size-5" />
              </button>
            </div>
            {nav}
            {footer}
          </div>
        </div>
      ) : null}

      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-ink-200 bg-white p-4 lg:flex">
        <Link href="/admin" className="mb-6 flex items-center gap-2 px-1">
          <span className="flex size-8 items-center justify-center rounded-lg bg-ink-900 text-white">
            <Store className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{shopName}</p>
            <p className="truncate text-xs text-ink-400">/{handle}</p>
          </div>
        </Link>
        {nav}
        {footer}
      </aside>
    </>
  );
}
