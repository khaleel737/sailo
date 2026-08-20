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
  HelpCircle,
  Mail,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  Quote,
  ScanLine,
  Package,
  ShieldCheck,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Tag,
  Tags,
  Truck,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { signOutSeller } from "@/lib/actions/auth";
import { SailoMark } from "@/components/brand";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { useAdminT } from "./admin-i18n";
import type { Dictionary } from "@sailo/i18n";
import type { AdminDictionary } from "@sailo/i18n/admin/en";
import type { Locale } from "@sailo/i18n/config";
import { cn } from "@sailo/design-system/web/cn";

/*
 * The rail, remade on Shopify's grammar: a light column beside a dark top
 * bar, a short list of doors, and rooms that appear *inside* the door you are
 * standing in — indented, text-only, hanging off a hairline. The dark rail
 * this replaces carried the brand; the brand lives in the top bar now, so the
 * rail's only job is saying where you are and where you can go.
 *
 * Five doors and a Setup shelf. A door's rooms reveal only while the door is
 * active — no chevrons, no remembered open state: navigation is the toggle,
 * which is also why arriving anywhere always shows you where you are.
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

const SECTIONS: NavSection[] = [
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
    children: [
      { href: "/admin/checkin", key: "checkin" },
      { href: "/admin/abandoned", key: "abandoned" },
    ],
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
      { href: "/admin/flows", key: "flows" },
      { href: "/admin/coupons", key: "coupons" },
      { href: "/admin/affiliates", key: "affiliates" },
    ],
  },
];

const SETUP = [
  { href: "/admin/payments", key: "payments", icon: CreditCard },
  { href: "/admin/delivery", key: "delivery", icon: Truck },
  { href: "/admin/data-requests", key: "dataRequests", icon: ShieldCheck },
] as const;

/** Icons for the mobile sheet's child rows, where a thumb reads by shape. */
const CHILD_ICONS: Record<string, typeof Package> = {
  checkin: ScanLine,
  abandoned: ShoppingCart,
  categories: Tag,
  reviews: MessageSquare,
  members: BadgeCheck,
  testimonials: Quote,
  broadcasts: Mail,
  flows: Workflow,
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

export type NavProps = {
  pendingReviews: number;
  newOrders: number;
  t: Dictionary;
};

/* --------------------------------------------------------------------------
   The list itself, shared by the desktop rail and the phone sheet.
-------------------------------------------------------------------------- */

function NavList({
  pendingReviews,
  newOrders,
  t,
  onNavigate,
  childIcons = false,
}: NavProps & {
  onNavigate?: () => void;
  /** The sheet draws child icons; the rail keeps children text-only. */
  childIcons?: boolean;
}) {
  const pathname = usePathname();
  const a = useAdminT();

  const badgeCount = (badge: "orders" | "reviews" | undefined) =>
    badge === "orders" ? newOrders : badge === "reviews" ? pendingReviews : 0;

  const count = (n: number) =>
    n > 0 ? (
      <span className="tabular rounded-full bg-brand-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
        {n}
      </span>
    ) : null;

  const rowClass = (active: boolean) =>
    cn(
      "focus-ring group relative flex w-full items-center gap-2 rounded-lg px-2.5 py-[7px] text-[13px] font-medium transition-colors duration-150 pointer-coarse:min-h-11",
      active
        ? "bg-white text-ink-900 shadow-xs"
        : "text-ink-600 hover:bg-ink-900/[0.05] hover:text-ink-900",
    );

  const section = (s: NavSection) => {
    const active = sectionIsActive(s, pathname);
    const selfActive = s.href
      ? s.exact
        ? pathname === s.href
        : pathname.startsWith(s.href)
      : false;
    const children = s.children ?? [];
    const expanded = children.length > 0 && active;
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

    const inner = (
      <>
        <s.icon
          className={cn(
            "size-4 shrink-0 transition-colors",
            selfActive || active
              ? "text-ink-900"
              : "text-ink-400 group-hover:text-ink-700",
          )}
        />
        <span className="flex-1 truncate text-start">{label}</span>
        {count(closedCount)}
      </>
    );

    return (
      <li key={s.id}>
        {s.href ? (
          <Link
            href={s.href}
            aria-current={selfActive ? "page" : undefined}
            onClick={onNavigate}
            className={rowClass(selfActive)}
          >
            {inner}
          </Link>
        ) : (
          /*
           * A door with no page of its own opens its first room — Broadcasts
           * for Growth. A row that navigates is one grammar for the whole
           * rail; a row that merely toggles would be the one item that
           * "doesn't work" when tapped.
           */
          <Link
            href={children[0]?.href ?? "/admin"}
            onClick={onNavigate}
            className={cn(rowClass(false), active && "text-ink-900")}
          >
            {inner}
          </Link>
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
              <ul className="ms-[1.1rem] mt-0.5 flex flex-col gap-0.5 border-s border-ink-200 ps-2 pb-1">
                {children.map((child) => {
                  const childActive = pathname.startsWith(child.href);
                  const Icon = childIcons ? CHILD_ICONS[child.key] : undefined;
                  return (
                    <li key={child.href}>
                      <Link
                        href={child.href}
                        aria-current={childActive ? "page" : undefined}
                        onClick={onNavigate}
                        tabIndex={expanded ? undefined : -1}
                        className={cn(
                          "focus-ring group flex items-center gap-2 rounded-lg px-2.5 py-[5px] text-[13px] font-medium transition-colors duration-150 pointer-coarse:min-h-11",
                          childActive
                            ? "bg-white text-ink-900 shadow-xs"
                            : "text-ink-500 hover:bg-ink-900/[0.05] hover:text-ink-900",
                        )}
                      >
                        {Icon ? (
                          <Icon
                            className={cn(
                              "size-3.5 shrink-0",
                              childActive ? "text-ink-700" : "text-ink-400",
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

  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto">
      <ul className="flex flex-col gap-0.5">{SECTIONS.map(section)}</ul>

      <div>
        <p className="mb-1.5 px-2.5 text-[11px] font-medium uppercase tracking-wide text-ink-400">
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
                  onClick={onNavigate}
                  className={rowClass(active)}
                >
                  <item.icon
                    className={cn(
                      "size-4 shrink-0 transition-colors",
                      active ? "text-ink-900" : "text-ink-400 group-hover:text-ink-700",
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
}

/** Settings, pinned under the scroll the way Shopify pins it — the one page
 *  you reach for from anywhere, always in the same corner. */
function SettingsLink({
  t,
  onNavigate,
}: {
  t: Dictionary;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = pathname.startsWith("/admin/settings");
  return (
    <div className="mt-3 border-t border-ink-200 pt-3">
      <Link
        href="/admin/settings"
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        className={cn(
          "focus-ring group flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-[13px] font-medium transition-colors duration-150 pointer-coarse:min-h-11",
          active
            ? "bg-white text-ink-900 shadow-xs"
            : "text-ink-600 hover:bg-ink-900/[0.05] hover:text-ink-900",
        )}
      >
        <Settings
          className={cn(
            "size-4 shrink-0 transition-colors",
            active ? "text-ink-900" : "text-ink-400 group-hover:text-ink-700",
          )}
        />
        {t.nav.settings}
      </Link>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Desktop rail — light, borderless items, under the dark top bar.
-------------------------------------------------------------------------- */

export function Sidebar(props: NavProps) {
  return (
    <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 flex-col border-e border-ink-200 bg-ink-50 px-3 py-4 lg:flex">
      <NavList {...props} />
      <SettingsLink t={props.t} />
    </aside>
  );
}

/* --------------------------------------------------------------------------
   The phone sheet, and the button in the top bar that opens it.
-------------------------------------------------------------------------- */

export function MobileMenu({
  shopName,
  handle,
  docsUrl,
  locale,
  ...nav
}: NavProps & {
  shopName: string;
  handle: string;
  docsUrl: string;
  locale: Locale;
}) {
  const a = useAdminT();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={nav.t.nav.openMenu}
        aria-expanded={open}
        className="focus-ring press grid size-9 place-items-center rounded-lg text-white/70 transition hover:bg-white/10 lg:hidden pointer-coarse:size-11"
      >
        <Menu className="size-5" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label={nav.t.nav.closeMenu}
            onClick={close}
            className="animate-backdrop absolute inset-0 bg-ink-950/50 backdrop-blur-[2px]"
          />
          <div className="animate-sheet-in absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col bg-ink-50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl">
            <div className="mb-4 flex items-center justify-between gap-2">
              <Link
                href="/admin"
                onClick={close}
                className="focus-ring flex min-w-0 items-center gap-2.5 rounded-xl px-1 py-1"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white">
                  <SailoMark className="size-5.5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink-900">
                    {shopName}
                  </span>
                  <span dir="ltr" className="block truncate text-start text-xs text-ink-500">
                    /{handle}
                  </span>
                </span>
              </Link>
              <button
                type="button"
                onClick={close}
                aria-label={nav.t.nav.closeMenu}
                className="focus-ring press grid size-9 place-items-center rounded-lg text-ink-500 transition hover:bg-ink-200/60 pointer-coarse:size-11"
              >
                <X className="size-5" />
              </button>
            </div>

            <NavList {...nav} onNavigate={close} childIcons />
            <SettingsLink t={nav.t} onNavigate={close} />

            {/* What the top bar carries on desktop, folded down here. */}
            <div className="mt-3 space-y-0.5 border-t border-ink-200 pt-3">
              <a
                href={`/${handle}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={close}
                className="focus-ring flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-[13px] font-medium text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900 pointer-coarse:min-h-11"
              >
                <ExternalLink className="size-4 text-ink-400" />
                {nav.t.nav.viewShop}
              </a>
              <Link
                href="/admin/support"
                onClick={close}
                className="focus-ring flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-[13px] font-medium text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900 pointer-coarse:min-h-11"
              >
                <HelpCircle className="size-4 text-ink-400" />
                {a.support.helpLabel}
              </Link>
              <a
                href={docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={close}
                className="focus-ring flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-[13px] font-medium text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900 pointer-coarse:min-h-11"
              >
                <Code className="size-4 text-ink-400" />
                {a.shell.docs}
              </a>
              {/*
                A form, not an onClick — sign-out revokes the session and moves
                the browser in one act. See `lib/actions/auth.ts`.
              */}
              <form action={signOutSeller}>
                <button
                  type="submit"
                  className="focus-ring flex w-full items-center gap-2 rounded-lg px-2.5 py-[7px] text-[13px] font-medium text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900 pointer-coarse:min-h-11"
                >
                  <LogOut className="size-4 text-ink-400" />
                  {nav.t.nav.signOut}
                </button>
              </form>
              <div className="px-1 pt-1">
                <LanguageSwitcher
                  current={locale}
                  align="start"
                  label={nav.t.common.language}
                  size="md"
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
