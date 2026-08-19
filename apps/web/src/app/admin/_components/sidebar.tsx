"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BadgeCheck,
  Code,
  CreditCard,
  ExternalLink,
  Gift,
  Mail,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Quote,
  ScanLine,
  Package,
  ScrollText,
  ShieldCheck,
  Settings,
  ShoppingBag,
  Tag,
  Tags,
  Truck,
  Users,
  X,
} from "lucide-react";
import { signOutSeller } from "@/lib/actions/auth";
import { SailoMark } from "@/components/brand";
import { useAdminT } from "./admin-i18n";
import type { Dictionary } from "@sailo/i18n";
import { cn } from "@sailo/design-system/web/cn";

/*
 * The same rail HQ uses: dark, grouped, with a brand rule marking position.
 *
 * The two panels used to be told apart by colour alone. They no longer are, so
 * that job moves to the block at the top — HQ says "Sailo HQ" over a white
 * tile, this says the shop's own name over a brand-green one with the role
 * spelled out above it. A name and a colour, rather than a colour by itself.
 */
const GROUPS = [
  {
    id: "catalogue",
    items: [
      { href: "/admin", key: "overview", icon: LayoutDashboard, exact: true },
      { href: "/admin/products", key: "products", icon: Package },
      { href: "/admin/categories", key: "categories", icon: Tag },
    ],
  },
  {
    id: "selling",
    items: [
      { href: "/admin/orders", key: "orders", icon: ShoppingBag },
      { href: "/admin/checkin", key: "checkin", icon: ScanLine },
      { href: "/admin/clients", key: "clients", icon: Users },
      { href: "/admin/members", key: "members", icon: BadgeCheck },
      { href: "/admin/reviews", key: "reviews", icon: MessageSquare },
      /*
       * Beside reviews rather than in Growth, because a seller looking for one
       * looks for the other — and because both are queues: something arrived
       * and somebody has to decide whether it goes on a public page. What they
       * *are* is different (spec 35 argues it at length), but where you find
       * them is the same place.
       */
      { href: "/admin/testimonials", key: "testimonials", icon: Quote },
    ],
  },
  {
    id: "growth",
    items: [
      { href: "/admin/coupons", key: "coupons", icon: Tags },
      { href: "/admin/broadcasts", key: "broadcasts", icon: Mail },
      { href: "/admin/affiliates", key: "affiliates", icon: Gift },
    ],
  },
  {
    id: "setup",
    items: [
      { href: "/admin/payments", key: "payments", icon: CreditCard },
      { href: "/admin/delivery", key: "delivery", icon: Truck },
      /*
       * The two obligations, in Setup rather than in Growth or Selling.
       *
       * Neither sells anything and neither is optional. A seller finds "Legal
       * pages" when they are setting the shop up, which is also the moment
       * `requireTerms` is worth turning on; "Data requests" has a statutory
       * clock on it and has to be somewhere a seller will pass, not behind a
       * settings accordion.
       */
      { href: "/admin/legal", key: "legal", icon: ScrollText },
      { href: "/admin/data-requests", key: "dataRequests", icon: ShieldCheck },
      { href: "/admin/settings", key: "settings", icon: Settings },
    ],
  },
] as const;

export function Sidebar({
  shopName,
  handle,
  pendingReviews,
  newOrders,
  docsUrl,
  actions,
  t,
}: {
  shopName: string;
  handle: string;
  pendingReviews: number;
  newOrders: number;
  /**
   * Where the developer documentation lives.
   *
   * Passed in rather than read here, which is the convention every origin in
   * this panel follows — the MCP URL on the Integrations tab is handed down the
   * same way. This is a client component, so reading it here would mean
   * trusting Next to inline the variable into the browser bundle and produce
   * the identical string on both sides of hydration; a prop from a server
   * component has neither question in it.
   */
  docsUrl: string;
  /** Header controls, folded into the mobile bar where there is no header. */
  actions?: React.ReactNode;
  t: Dictionary;
}) {
  const pathname = usePathname();
  const a = useAdminT();
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

  const brand = (
    <Link
      href="/admin"
      onClick={() => setOpen(false)}
      className="focus-ring flex items-center gap-2.5 rounded-xl px-1 py-1"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white">
        <SailoMark className="size-5.5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-medium uppercase tracking-wide text-brand-400">
          {a.shell.role}
        </span>
        <span className="block truncate text-sm font-semibold text-white">
          {shopName}
        </span>
        <span dir="ltr" className="block truncate text-start text-xs text-white/40">
          /{handle}
        </span>
      </span>
    </Link>
  );

  const nav = (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto">
      {GROUPS.map((group) => (
        <div key={group.id}>
          <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wide text-white/30">
            {a.navGroups[group.id]}
          </p>
          <ul className="flex flex-col gap-0.5">
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
                    aria-current={active ? "page" : undefined}
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
                    <span className="flex-1 truncate">{t.nav[item.key]}</span>
                    {badge > 0 ? (
                      // Light-on-dark, so a count reads as a count rather than
                      // as another dark chip lost against the rail.
                      <span className="tabular rounded-full bg-brand-400 px-1.5 py-0.5 text-[11px] font-semibold text-ink-950">
                        {badge}
                      </span>
                    ) : null}
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
      <a
        href={`/${handle}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => setOpen(false)}
        className="focus-ring flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-white/60 transition hover:bg-white/5 hover:text-white pointer-coarse:min-h-11"
      >
        <ExternalLink className="size-4 text-white/40" />
        {t.nav.viewShop}
      </a>
      {/*
        The developer documentation — the REST API, the webhooks and the MCP
        server, at docs.sailo.store.

        Beside "View shop" rather than in a group above, because like that one
        it leaves the panel: the docs are public, unauthenticated and a
        different deployment entirely, while the groups are all pages of this
        admin. A new tab for the same reason — a seller reads it while wiring
        something up on the Integrations tab, and navigating away would lose the
        key they were halfway through creating.
      */}
      <a
        href={docsUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => setOpen(false)}
        className="focus-ring flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-white/60 transition hover:bg-white/5 hover:text-white pointer-coarse:min-h-11"
      >
        <Code className="size-4 text-white/40" />
        {a.shell.docs}
      </a>
      {/*
        A form, not an onClick.

        Sign-out revokes the session and moves the browser, and those two have
        to be one act. As a client fetch they were two: better-auth's client
        answers `{ error }` rather than throwing, so a 500 or a rate-limited
        429 still fell through to `router.push("/login")` and told the seller
        they were signed out while the cookie and the session were both alive.
        The Server Action does the revoke, the cookie and the redirect in a
        single response — see `lib/actions/auth.ts`.
      */}
      <form action={signOutSeller}>
        <button
          type="submit"
          className="focus-ring flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-white/60 transition hover:bg-white/5 hover:text-white pointer-coarse:min-h-11"
        >
          <LogOut className="size-4 text-white/40" />
          {t.nav.signOut}
        </button>
      </form>
    </div>
  );

  return (
    <>
      {/* Mobile bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between bg-ink-950 px-4 py-2.5 lg:hidden">
        {brand}
        <div className="flex items-center gap-1">
          {actions}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t.nav.openMenu}
            aria-expanded={open}
            className="focus-ring press grid size-9 place-items-center rounded-xl text-white/70 transition hover:bg-white/10 pointer-coarse:size-11"
          >
            <Menu className="size-5" />
          </button>
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label={t.nav.closeMenu}
            onClick={() => setOpen(false)}
            className="animate-backdrop absolute inset-0 bg-ink-950/60 backdrop-blur-[2px]"
          />
          <div className="animate-sheet-in absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col bg-ink-950 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl">
            <div className="mb-6 flex items-center justify-between gap-2">
              {brand}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t.nav.closeMenu}
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
