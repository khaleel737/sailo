"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BadgeCheck,
  ChevronDown,
  Code,
  CreditCard,
  ExternalLink,
  Gift,
  Mail,
  LayoutDashboard,
  LogOut,
  Megaphone,
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
import type { AdminDictionary } from "@sailo/i18n/admin/en";
import { cn } from "@sailo/design-system/web/cn";

/*
 * The same rail HQ uses: dark, with a brand rule marking position — but
 * structured the way a commerce admin's day is structured rather than as one
 * long list.
 *
 * Fifteen flat entries became five doors and a Setup shelf. Each door is the
 * page a seller opens daily (Orders, Products, Clients); the pages that serve
 * it (Check-in serves Orders, Categories and Reviews serve Products) sit
 * *inside* it, revealed when the section is active and collapsible by hand.
 * Growth is the one door that is only a door — Broadcasts, Coupons and
 * Affiliates are siblings with no parent page, so its row discloses rather
 * than navigates.
 *
 * Setup keeps its heading and stays flat: Payments, Delivery, Legal and Data
 * requests are visited rarely and found by reading, and "Data requests" has a
 * statutory clock on it — it must be visible on every pass, never folded away.
 */
type NavKey = keyof Dictionary["nav"];
type GroupKey = keyof AdminDictionary["navGroups"];

type NavChild = {
  href: string;
  key: NavKey;
  /** Which badge count this row shows, if any. */
  badge?: "reviews";
};

type NavSection = {
  id: string;
  icon: typeof Package;
  exact?: boolean;
  badge?: "orders";
  children?: NavChild[];
} & (
  | { href: string; key: NavKey; labelFrom: "nav" }
  /** A section that is only a door — its row discloses, not navigates. */
  | { href?: undefined; key: GroupKey; labelFrom: "groups" }
);

const SECTIONS: readonly NavSection[] = [
  {
    id: "home",
    href: "/admin",
    icon: LayoutDashboard,
    key: "overview",
    labelFrom: "nav",
    exact: true,
  },
  {
    id: "orders",
    href: "/admin/orders",
    icon: ShoppingBag,
    key: "orders",
    labelFrom: "nav",
    badge: "orders",
    children: [{ href: "/admin/checkin", key: "checkin" }],
  },
  {
    id: "products",
    href: "/admin/products",
    icon: Package,
    key: "products",
    labelFrom: "nav",
    children: [
      { href: "/admin/categories", key: "categories" },
      { href: "/admin/reviews", key: "reviews", badge: "reviews" },
    ],
  },
  {
    id: "clients",
    href: "/admin/clients",
    icon: Users,
    key: "clients",
    labelFrom: "nav",
    children: [
      { href: "/admin/members", key: "members" },
      /*
       * Beside Members rather than under Growth: a testimonial is a thing a
       * client gave you, moderated the way reviews are (spec 35 argues what
       * they *are* at length) — and the person looking for one is thinking
       * about a client, not a campaign.
       */
      { href: "/admin/testimonials", key: "testimonials" },
    ],
  },
  {
    id: "growth",
    icon: Megaphone,
    key: "growth",
    labelFrom: "groups",
    children: [
      { href: "/admin/broadcasts", key: "broadcasts" },
      { href: "/admin/coupons", key: "coupons" },
      { href: "/admin/affiliates", key: "affiliates" },
    ],
  },
];

const SETUP = [
  { href: "/admin/payments", key: "payments", icon: CreditCard },
  { href: "/admin/delivery", key: "delivery", icon: Truck },
  { href: "/admin/legal", key: "legal", icon: ScrollText },
  { href: "/admin/data-requests", key: "dataRequests", icon: ShieldCheck },
  { href: "/admin/settings", key: "settings", icon: Settings },
] as const;

/** The child icons, kept for the mobile sheet where rows are read by thumb. */
const CHILD_ICONS: Record<string, typeof Package> = {
  checkin: ScanLine,
  categories: Tag,
  reviews: MessageSquare,
  members: BadgeCheck,
  testimonials: Quote,
  broadcasts: Mail,
  coupons: Tags,
  affiliates: Gift,
};

function sectionIsActive(section: NavSection, pathname: string): boolean {
  if (section.href) {
    if (section.exact ? pathname === section.href : pathname.startsWith(section.href))
      return true;
  }
  return (section.children ?? []).some((c) => pathname.startsWith(c.href));
}

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
  /*
   * Which sections the seller has opened or closed by hand. The active
   * section is always open unless they closed it themselves; navigating into
   * a section clears any old override so arriving somewhere always shows
   * where you are.
   */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  /*
   * Reconciled during render rather than in an effect: a new page means the
   * old hand-closed states no longer describe intent, and React re-renders
   * immediately with the cleared state instead of painting the stale one
   * first and correcting it a frame later.
   */
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOverrides({});
  }

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

  const badgeCount = (badge: "orders" | "reviews" | undefined) =>
    badge === "orders" ? newOrders : badge === "reviews" ? pendingReviews : 0;

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

  const count = (n: number) =>
    n > 0 ? (
      // Light-on-dark, so a count reads as a count rather than as another
      // dark chip lost against the rail.
      <span className="tabular rounded-full bg-brand-400 px-1.5 py-0.5 text-[11px] font-semibold text-ink-950">
        {n}
      </span>
    ) : null;

  const leafClass = (active: boolean) =>
    cn(
      "focus-ring group relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150 pointer-coarse:min-h-11",
      active
        ? "bg-white/10 text-white"
        : "text-white/60 hover:bg-white/5 hover:text-white",
    );

  const rule = (active: boolean) => (
    <span
      aria-hidden
      className={cn(
        "absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-brand-400 transition-opacity duration-200",
        active ? "opacity-100" : "opacity-0",
      )}
    />
  );

  const section = (s: NavSection) => {
    const active = sectionIsActive(s, pathname);
    const selfActive = s.href
      ? s.exact
        ? pathname === s.href
        : pathname.startsWith(s.href)
      : false;
    const children = s.children ?? [];
    const expanded = children.length > 0 && (overrides[s.id] ?? active);
    const label = s.labelFrom === "nav" ? t.nav[s.key] : a.navGroups[s.key];
    /*
     * A closed door still says what is behind it: the section's own count
     * plus its children's, so three pending reviews are three whether or not
     * Products happens to be open.
     */
    const closedCount = expanded
      ? badgeCount(s.badge)
      : badgeCount(s.badge) +
        children.reduce((sum, c) => sum + badgeCount(c.badge), 0);

    const chevron =
      children.length > 0 ? (
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-white/30 transition-transform duration-200 group-hover:text-white/60",
            !expanded && "-rotate-90 rtl:rotate-90",
          )}
        />
      ) : null;

    const inner = (
      <>
        {rule(selfActive)}
        <s.icon
          className={cn(
            "size-4 shrink-0 transition-colors",
            active ? "text-brand-400" : "text-white/40 group-hover:text-white/70",
          )}
        />
        <span className="flex-1 truncate text-start">{label}</span>
        {count(closedCount)}
        {chevron}
      </>
    );

    return (
      <li key={s.id}>
        {s.href ? (
          <Link
            href={s.href}
            aria-current={selfActive ? "page" : undefined}
            aria-expanded={children.length > 0 ? expanded : undefined}
            onClick={() => {
              setOpen(false);
              // Opening a door shows its rooms; navigation does the rest.
              if (children.length > 0)
                setOverrides((prev) => ({ ...prev, [s.id]: true }));
            }}
            className={leafClass(selfActive)}
          >
            {inner}
          </Link>
        ) : (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() =>
              setOverrides((prev) => ({ ...prev, [s.id]: !expanded }))
            }
            className={cn(leafClass(false), "w-full", active && "text-white")}
          >
            {inner}
          </button>
        )}

        {children.length > 0 ? (
          /*
           * The disclosure. Grid rows animate where height cannot: 0fr → 1fr
           * is a real CSS transition, so the rooms slide out of the door
           * rather than appearing — and back in when it closes.
           */
          <div
            className={cn(
              "grid transition-[grid-template-rows] duration-300 ease-[var(--ease-out-expo)]",
              expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            )}
          >
            <div className="min-h-0 overflow-hidden">
              <ul className="ms-[1.4rem] mt-0.5 flex flex-col gap-0.5 border-s border-white/10 ps-2 pb-1">
                {children.map((child) => {
                  const childActive = pathname.startsWith(child.href);
                  const Icon = CHILD_ICONS[child.key];
                  return (
                    <li key={child.href}>
                      <Link
                        href={child.href}
                        aria-current={childActive ? "page" : undefined}
                        onClick={() => setOpen(false)}
                        tabIndex={expanded ? undefined : -1}
                        className={cn(
                          "focus-ring group flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150 pointer-coarse:min-h-11",
                          childActive
                            ? "bg-white/10 text-white"
                            : "text-white/50 hover:bg-white/5 hover:text-white",
                        )}
                      >
                        {Icon ? (
                          <Icon
                            className={cn(
                              "size-3.5 shrink-0 transition-colors",
                              childActive
                                ? "text-brand-400"
                                : "text-white/30 group-hover:text-white/60",
                            )}
                          />
                        ) : null}
                        <span className="flex-1 truncate">{t.nav[child.key]}</span>
                        {count(badgeCount(child.badge))}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ) : null}
      </li>
    );
  };

  const nav = (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto">
      <ul className="flex flex-col gap-0.5">{SECTIONS.map(section)}</ul>

      <div>
        <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wide text-white/30">
          {a.navGroups.setup}
        </p>
        <ul className="flex flex-col gap-0.5">
          {SETUP.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={leafClass(active)}
                >
                  {rule(active)}
                  <item.icon
                    className={cn(
                      "size-4 shrink-0 transition-colors",
                      active
                        ? "text-brand-400"
                        : "text-white/40 group-hover:text-white/70",
                    )}
                  />
                  <span className="flex-1 truncate">{t.nav[item.key]}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
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
