"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Gift,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  ShoppingBag,
  UserRound,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { SailoMark } from "@/components/brand";
import { cn } from "@/lib/utils";

/*
 * HQ is deliberately dark where /admin is light.
 *
 * Both panels show shops, orders and money, and the two are one click apart.
 * The colour is the thing that stops someone editing a seller's catalogue when
 * they meant to look at the business — you can tell which room you are in from
 * the corner of your eye, before you read a word.
 */
const GROUPS = [
  {
    id: "business",
    label: "Business",
    items: [
      { href: "/hq", label: "Overview", icon: LayoutDashboard, exact: true },
      { href: "/hq/accounts", label: "Accounts", icon: Users },
      { href: "/hq/revenue", label: "Revenue", icon: Wallet },
    ],
  },
  {
    id: "activity",
    label: "What they're doing",
    items: [
      { href: "/hq/orders", label: "Orders", icon: ShoppingBag },
      { href: "/hq/products", label: "Products", icon: Package },
      { href: "/hq/affiliates", label: "Affiliates", icon: Gift },
      { href: "/hq/buyers", label: "Buyers", icon: UserRound },
    ],
  },
  {
    id: "platform",
    label: "Platform",
    items: [{ href: "/hq/system", label: "System", icon: Activity }],
  },
] as const;

export function HqSidebar({ email }: { email: string }) {
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
      href="/hq"
      onClick={() => setOpen(false)}
      className="focus-ring flex items-center gap-2.5 rounded-xl px-1 py-1"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-ink-950">
        <SailoMark className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-white">
          Sailo HQ
        </span>
        <span className="block truncate text-xs text-white/40">{email}</span>
      </span>
    </Link>
  );

  const nav = (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto">
      {GROUPS.map((group) => (
        <div key={group.id}>
          <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wide text-white/30">
            {group.label}
          </p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active =
                "exact" in item && item.exact
                  ? pathname === item.href
                  : pathname.startsWith(item.href);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    // Closes the drawer as you leave, rather than watching the
                    // path for a change that this click already knows about.
                    onClick={() => setOpen(false)}
                    className={cn(
                      "focus-ring group relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150 pointer-coarse:min-h-11",
                      active
                        ? "bg-white/10 text-white"
                        : "text-white/60 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-brand-400 transition-opacity duration-200",
                        active ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <item.icon
                      className={cn(
                        "size-4 shrink-0 transition-colors",
                        active
                          ? "text-brand-400"
                          : "text-white/40 group-hover:text-white/70",
                      )}
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const footer = (
    <div className="mt-5 space-y-0.5 border-t border-white/10 pt-3">
      <Link
        href="/admin"
        onClick={() => setOpen(false)}
        className="focus-ring flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-white/60 transition hover:bg-white/5 hover:text-white pointer-coarse:min-h-11"
      >
        <ArrowLeft className="size-4 text-white/40" />
        My own shop
      </Link>
      <button
        type="button"
        onClick={onSignOut}
        className="focus-ring flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-white/60 transition hover:bg-white/5 hover:text-white pointer-coarse:min-h-11"
      >
        <LogOut className="size-4 text-white/40" />
        Sign out
      </button>
    </div>
  );

  return (
    <>
      {/* Mobile bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between bg-ink-950 px-4 py-2.5 lg:hidden">
        {brand}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="focus-ring press grid size-9 place-items-center rounded-xl text-white/70 transition hover:bg-white/10 pointer-coarse:size-11"
        >
          <Menu className="size-5" />
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="animate-backdrop absolute inset-0 bg-ink-950/60 backdrop-blur-[2px]"
          />
          <div className="animate-sheet-in absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col bg-ink-950 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl">
            <div className="mb-6 flex items-center justify-between gap-2">
              {brand}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="focus-ring press grid size-9 place-items-center rounded-xl text-white/60 transition hover:bg-white/10 pointer-coarse:size-11"
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
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-ink-950 p-4 lg:flex">
        <div className="mb-6">{brand}</div>
        {nav}
        {footer}
      </aside>
    </>
  );
}
