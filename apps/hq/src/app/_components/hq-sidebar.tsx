"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  AtSign,
  Archive,
  CreditCard,
  Gift,
  Handshake,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Megaphone,
  Menu,
  Package,
  Radar,
  Route,
  Send,
  ShieldCheck,
  Gavel,
  ShoppingBag,
  UserCog,
  UserRound,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { signOutStaff } from "@/lib/actions/auth";
import { SailoMark } from "@sailo/design-system/web/brand";
import { cn } from "@sailo/design-system/web/cn";

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
      { href: "/", label: "Overview", icon: LayoutDashboard, exact: true },
      { href: "/accounts", label: "Accounts", icon: Users },
      { href: "/revenue", label: "Revenue", icon: Wallet },
      /*
       * Under Business, not beside Affiliates. Both lists are commission, but
       * an affiliate is paid by a seller out of their own sale and this is
       * paid by us out of our subscription revenue — so it belongs next to
       * the revenue it comes out of.
       */
      { href: "/partners", label: "Partners", icon: Handshake },
    ],
  },
  /*
   * Our own marketing, not theirs.
   *
   * Deliberately its own group rather than an item under Business. Everything
   * in Business is a *reading* of what sellers did — accounts, revenue,
   * commission — and every screen here is something we do on purpose: a list
   * we grew, a campaign we wrote, a pipeline that writes to people. Two
   * different verbs, and putting a Send button in a group of dashboards is how
   * somebody presses one while skimming.
   *
   * It is also the group that will grow. Attribution, referral campaigns, the
   * blog's own performance and whatever paid acquisition turns into all belong
   * behind this label, and each of them would be a stranger anywhere else in
   * this sidebar.
   */
  {
    id: "marketing",
    label: "Marketing",
    items: [
      { href: "/marketing", label: "Overview", icon: Megaphone, exact: true },
      { href: "/marketing/subscribers", label: "Subscribers", icon: AtSign },
      { href: "/marketing/campaigns", label: "Campaigns", icon: Send },
      /*
       * "Journeys" and not "Lifecycle". The pipeline is called lifecycle in the
       * code because that is what the table is; the word on a sidebar has to
       * say what the screen shows, which is the path a seller takes and what we
       * send them along it.
       */
      { href: "/marketing/journeys", label: "Journeys", icon: Route },
    ],
  },
  {
    id: "activity",
    label: "What they're doing",
    items: [
      { href: "/orders", label: "Orders", icon: ShoppingBag },
      /*
       * Beside Orders, and it is a different screen. /orders answers "what did
       * somebody buy"; /payments answers "what happened to the money", which is
       * a question about rails, refunds and Stripe objects rather than about
       * products. They look alike right up until something goes wrong with one
       * of them, which is the moment somebody needs the second one.
       */
      { href: "/payments", label: "Payments", icon: CreditCard },
      { href: "/products", label: "Products", icon: Package },
      { href: "/affiliates", label: "Affiliates", icon: Gift },
      { href: "/buyers", label: "Buyers", icon: UserRound },
    ],
  },
  /*
   * Trust & safety, which is new, and which took Chargebacks out of the group
   * above.
   *
   * That move overturns a decision this file used to argue for: a chargeback
   * was filed under "What they're doing" because it "is a thing that happened
   * to an order, and the person who opens it has almost always come from one".
   * That was true, and it stopped being true when the risk desk was built. The
   * person opening a chargeback now has almost always come from /risk — it is
   * the screen that told them which shop to look at — and the three items here
   * are one shift's work rather than three unrelated tables: what is going
   * wrong now, what a bank is already arguing about, and what walked away.
   *
   * Security stays under Platform. It reads per-account but its question is
   * about the estate — who is signed in, from where, holding what key — and it
   * is about sellers being attacked rather than sellers doing the attacking.
   * Those are different jobs on different days.
   */
  {
    id: "trust",
    label: "Trust & safety",
    items: [
      { href: "/risk", label: "Risk", icon: Radar },
      { href: "/disputes", label: "Chargebacks", icon: Gavel },
      /*
       * "Closures" and not "Deleted shops". The screen is not a list of
       * tombstones — /accounts?shopState=deleted is that, and it is useless,
       * every row being an identical `deleted-3f2a…`. This is the record of
       * what each shop *was* on the way out, which is a different noun.
       */
      { href: "/closures", label: "Closures", icon: Archive },
    ],
  },
  {
    id: "platform",
    label: "Platform",
    items: [
      { href: "/support", label: "Support", icon: LifeBuoy },
      /*
       * Under Platform rather than beside Accounts. It reads per-account —
       * this seller's devices, that seller's keys — but the thing it is for is
       * the estate: one account signed in from two countries is a holiday, and
       * the same shape across forty of them is an incident, and only this
       * grouping puts it next to the other questions asked of the whole
       * platform at once.
       */
      { href: "/security", label: "Security", icon: ShieldCheck },
      /*
       * Under Platform, beside Security, because that is what it is: who holds
       * a key to every seller's revenue. Not a "settings" page — there is no
       * settings group here and this should not be the reason to invent one.
       */
      { href: "/members", label: "Members", icon: UserCog },
      { href: "/system", label: "System", icon: Activity },
    ],
  },
] as const;

export function HqSidebar({ email }: { email: string }) {
  const pathname = usePathname();
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
      href="/"
      onClick={() => setOpen(false)}
      className="focus-ring flex items-center gap-2.5 rounded-xl px-1 py-1"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-ink-950">
        <SailoMark className="size-5.5" />
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
      {/*
       * There was a "My own shop" link here, back to /admin. It made sense when
       * this panel was a route inside the seller app and the two shared a
       * session — one click between the thing you run and the thing you sell
       * on. They are separate deployments now, so it was a cross-origin hop to
       * a different product, and this rail is for running Sailo.
       */}
      {/* One act, one response — see the note on the seller sidebar's form. */}
      <form action={signOutStaff}>
        <button
          type="submit"
          className="focus-ring flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-white/60 transition hover:bg-white/5 hover:text-white pointer-coarse:min-h-11"
        >
          <LogOut className="size-4 text-white/40" />
          Sign out
        </button>
      </form>
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
