"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
  Tag,
  Tags,
  Truck,
  Users,
  X,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { SailoMark } from "@/components/brand";
import type { Dictionary } from "@/i18n";
import { cn } from "@/lib/utils";

/*
 * Nav is grouped rather than listed. Eleven flat links all read as equally
 * likely; three groups say what the admin is actually for — the things you
 * sell, the people buying them, and the machinery underneath.
 */
const GROUPS = [
  {
    id: "sell",
    items: [
      { href: "/admin", key: "overview", icon: LayoutDashboard, exact: true },
      { href: "/admin/products", key: "products", icon: Package },
      { href: "/admin/categories", key: "categories", icon: Tag },
    ],
  },
  {
    id: "trade",
    items: [
      { href: "/admin/orders", key: "orders", icon: ShoppingBag },
      { href: "/admin/clients", key: "clients", icon: Users },
      { href: "/admin/reviews", key: "reviews", icon: MessageSquare },
    ],
  },
  {
    id: "grow",
    items: [
      { href: "/admin/coupons", key: "coupons", icon: Tags },
      { href: "/admin/affiliates", key: "affiliates", icon: Gift },
    ],
  },
  {
    id: "setup",
    items: [
      { href: "/admin/payments", key: "payments", icon: CreditCard },
      { href: "/admin/delivery", key: "delivery", icon: Truck },
      { href: "/admin/settings", key: "settings", icon: Settings },
    ],
  },
] as const;

export function Sidebar({
  shopName,
  handle,
  pendingReviews,
  newOrders,
  actions,
  t,
}: {
  shopName: string;
  handle: string;
  pendingReviews: number;
  newOrders: number;
  /** Header controls, folded into the mobile bar where there is no header. */
  actions?: React.ReactNode;
  t: Dictionary;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  async function onSignOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  const brand = (
    <Link
      href="/admin"
      className="focus-ring flex items-center gap-2.5 rounded-xl px-1 py-1"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-white shadow-xs">
        <SailoMark className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-ink-900">
          {shopName}
        </span>
        <span className="block truncate text-xs text-ink-400">/{handle}</span>
      </span>
    </Link>
  );

  const nav = (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto">
      {GROUPS.map((group) => (
        <ul key={group.id} className="flex flex-col gap-0.5">
          {group.items.map((item) => {
            const active =
              "exact" in item && item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
            const badge =
              item.href === "/admin/reviews"
                ? pendingReviews
                : item.href === "/admin/orders"
                  ? newOrders
                  : 0;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "focus-ring group relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150",
                    active
                      ? "bg-brand-50 text-brand-800"
                      : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
                  )}
                >
                  {/* A rail on the leading edge, not a filled pill: it marks
                      position without turning every page into a dark block. */}
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-brand-600 transition-opacity duration-200",
                      active ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <item.icon
                    className={cn(
                      "size-4 shrink-0 transition-colors",
                      active ? "text-brand-700" : "text-ink-400 group-hover:text-ink-600",
                    )}
                  />
                  <span className="flex-1 truncate">{t.nav[item.key]}</span>
                  {badge > 0 ? (
                    <span
                      className={cn(
                        "tabular rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                        active
                          ? "bg-brand-700 text-white"
                          : "bg-ink-900 text-white",
                      )}
                    >
                      {badge}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ))}
    </nav>
  );

  const footer = (
    <div className="mt-5 space-y-0.5 border-t border-ink-200 pt-3">
      <a
        href={`/${handle}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => setOpen(false)}
        className="focus-ring flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-ink-600 transition hover:bg-ink-100 hover:text-ink-900"
      >
        <ExternalLink className="size-4 text-ink-400" />
        {t.nav.viewShop}
      </a>
      <button
        type="button"
        onClick={onSignOut}
        className="focus-ring flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-ink-600 transition hover:bg-ink-100 hover:text-ink-900"
      >
        <LogOut className="size-4 text-ink-400" />
        {t.nav.signOut}
      </button>
    </div>
  );

  return (
    <>
      {/* Mobile bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-200 bg-white/90 px-4 py-2.5 backdrop-blur lg:hidden">
        {brand}
        <div className="flex items-center gap-1">
          {actions}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t.nav.openMenu}
            aria-expanded={open}
            className="focus-ring press rounded-xl p-2 text-ink-600 transition hover:bg-ink-100"
          >
            <Menu className="size-5" />
          </button>
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label={t.nav.closeMenu}
            onClick={() => setOpen(false)}
            className="animate-backdrop absolute inset-0 bg-ink-950/45 backdrop-blur-[2px]"
          />
          <div className="animate-sheet-in absolute inset-y-0 start-0 flex w-72 flex-col bg-white p-4 shadow-xl">
            <div className="mb-6 flex items-center justify-between gap-2">
              {brand}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t.nav.closeMenu}
                className="focus-ring press rounded-xl p-2 text-ink-500 transition hover:bg-ink-100"
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
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-e border-ink-200 bg-white p-4 lg:flex">
        <div className="mb-6">{brand}</div>
        {nav}
        {footer}
      </aside>
    </>
  );
}
