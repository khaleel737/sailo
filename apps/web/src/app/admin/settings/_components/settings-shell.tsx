"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowUpRight,
  CalendarClock,
  CreditCard,
  Database,
  Landmark,
  ListChecks,
  Plug,
  ScrollText,
  Settings,
  ShieldCheck,
  Store,
  UsersRound,
  Wallet,
  X,
} from "lucide-react";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { cn } from "@sailo/design-system/web/cn";

/**
 * Settings as a room you step into, not a page you wander to.
 *
 * Shopify's move, adopted whole: the gear opens a full-screen surface over
 * the admin with its own rail of sections, and closing it puts you back to
 * work. It earns the modal (the impeccable rule is *exhaust inline first*)
 * because settings genuinely is an interruption — nobody configures tax
 * rates *while* fulfilling an order, and giving configuration its own frame
 * keeps eighteen sections out of the everyday rail.
 *
 * Still routes underneath: every section is a URL, deep links and the back
 * button work, and each page keeps its own capability check. Only the
 * chrome is new.
 */
export function SettingsShell({ children }: { children: React.ReactNode }) {
  const a = useAdminT();
  const pathname = usePathname();
  const router = useRouter();
  const reduced = useReducedMotion();

  /*
   * One list, drawn twice — the rail on wide screens, a pill row on phones.
   * Labels are the keys these pages have always had; nothing was renamed on
   * the way into the overlay.
   */
  const items = [
    { href: "/admin/settings", label: a.settings.tabDetails, icon: Store, exact: true },
    { href: "/admin/settings/billing", label: a.settings.tabBilling, icon: CreditCard },
    { href: "/admin/settings/tax", label: a.tax.title, icon: Landmark },
    { href: "/admin/settings/team", label: a.settings.tabTeam, icon: UsersRound },
    { href: "/admin/settings/staff", label: a.productForm.staffTitle, icon: CalendarClock },
    { href: "/admin/settings/integrations", label: a.integrations.title, icon: Plug },
    { href: "/admin/settings/fields", label: a.broadcasts.fieldsTitle, icon: ListChecks },
    /*
     * Moved in from the rail's Setup shelf: a legal page is configured once
     * and consulted rarely — configuration lives here. The old /admin/legal
     * address redirects.
     */
    { href: "/admin/settings/legal", label: a.legal.title, icon: ScrollText },
    { href: "/admin/settings/security", label: a.settings.tabSecurity, icon: ShieldCheck },
    { href: "/admin/settings/data", label: a.settings.tabData, icon: Database },
  ];

  const isActive = (item: (typeof items)[number]) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);
  const current = items.find(isActive) ?? items[0]!;

  const close = () => router.push("/admin");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Let an open dialog above (a confirm, the palette) take its own Escape.
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    /*
     * Below the top bar, not over it — Shopify keeps the bar interactive
     * above settings, and so do we: ⌘K and the bell still work in here.
     */
    <div
      className="fixed inset-x-0 bottom-0 top-14 z-40"
      role="dialog"
      aria-modal="true"
      aria-label={a.settings.title}
    >
      <motion.button
        type="button"
        tabIndex={-1}
        aria-label={a.settings.close}
        onClick={close}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-0 bg-ink-950/50 backdrop-blur-[2px]"
      />

      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", duration: 0.4, bounce: 0.1 }}
        className="absolute inset-x-0 bottom-0 top-2 flex flex-col overflow-hidden rounded-t-2xl bg-ink-50 shadow-2xl sm:inset-x-4 sm:bottom-4 sm:rounded-2xl lg:inset-x-6 lg:bottom-6"
      >
        <button
          type="button"
          onClick={close}
          aria-label={a.settings.close}
          className="focus-ring press absolute end-3 top-3 z-10 grid size-9 place-items-center rounded-lg text-ink-500 transition hover:bg-ink-200/60 hover:text-ink-900 pointer-coarse:size-11"
        >
          <X className="size-5" />
        </button>

        <div className="flex min-h-0 flex-1">
          {/* The rail — wide screens. */}
          <div className="hidden w-60 shrink-0 flex-col overflow-y-auto border-e border-ink-200 px-3 py-4 md:flex">
            <p className="mb-3 flex items-center gap-2 px-2.5 text-sm font-semibold text-ink-900">
              <Settings className="size-4 text-ink-500" />
              {a.settings.title}
            </p>
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => {
                const active = isActive(item);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "focus-ring group flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-[13px] font-medium transition-colors duration-150 pointer-coarse:min-h-11",
                        active
                          ? "bg-white text-ink-900 shadow-xs"
                          : "text-ink-600 hover:bg-ink-900/[0.05] hover:text-ink-900",
                      )}
                    >
                      <item.icon
                        className={cn(
                          "size-4 shrink-0 transition-colors",
                          active ? "text-ink-900" : "text-ink-400 group-hover:text-ink-700",
                        )}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/*
              Payment rails live on their own page — a seller checks them
              between orders, not only while configuring. But the person who
              came *here* to set up money should still find the door, so the
              room cross-links out (and Setup on the rail keeps Payments too).
            */}
            <div className="mt-3 border-t border-ink-200 pt-3">
              <Link
                href="/admin/payments"
                className="focus-ring group flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-[13px] font-medium text-ink-600 transition-colors duration-150 hover:bg-ink-900/[0.05] hover:text-ink-900 pointer-coarse:min-h-11"
              >
                <Wallet className="size-4 shrink-0 text-ink-400 transition-colors group-hover:text-ink-700" />
                <span className="flex-1 truncate">{a.payments.title}</span>
                <ArrowUpRight className="size-3.5 shrink-0 text-ink-300" />
              </Link>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Phones: the same sections as a scrollable pill row. */}
            <div className="flex items-center gap-1 overflow-x-auto border-b border-ink-200 px-3 py-2 pe-14 md:hidden">
              {items.map((item) => {
                const active = isActive(item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "focus-ring inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-medium transition-colors pointer-coarse:h-10",
                      active
                        ? "bg-white text-ink-900 shadow-xs"
                        : "text-ink-500 hover:bg-ink-900/[0.05] hover:text-ink-900",
                    )}
                  >
                    <item.icon className="size-3.5" />
                    {item.label}
                  </Link>
                );
              })}
              <Link
                href="/admin/payments"
                className="focus-ring inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-medium text-ink-500 transition-colors hover:bg-ink-900/[0.05] hover:text-ink-900 pointer-coarse:h-10"
              >
                <Wallet className="size-3.5" />
                {a.payments.title}
                <ArrowUpRight className="size-3 text-ink-300" />
              </Link>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8">
                <h1 className="mb-5 pe-10 text-lg font-semibold tracking-tight text-ink-900">
                  {current.label}
                </h1>
                {children}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
