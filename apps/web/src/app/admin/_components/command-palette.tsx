"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  BadgeCheck,
  CornerDownLeft,
  CreditCard,
  Gift,
  HelpCircle,
  LayoutDashboard,
  Mail,
  MessageSquare,
  Package,
  Plus,
  Quote,
  ScanLine,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Tag,
  Tags,
  Truck,
  Users,
  Workflow,
} from "lucide-react";
import { createPortal } from "react-dom";
import { Spinner } from "@sailo/design-system/web";
import { cn } from "@sailo/design-system/web/cn";
import { useAdminT } from "./admin-i18n";

/**
 * ⌘K — the whole admin, one keystroke away.
 *
 * Shopify puts a search box in the middle of its top bar and every seller
 * learns to live in it. Ours searches what the panel actually has: every
 * page, the verbs between pages (add a product, write a broadcast, open the
 * shop) — and, from two characters on, the shop's own rows: orders, products
 * and clients, fetched from `/api/admin/palette` behind the same capability
 * checks as the pages the results open.
 *
 * Deliberately unanimated. This opens from the keyboard, tens of times a
 * day; motion on a control used that often reads as latency, not polish
 * (the Raycast rule). One 120ms fade covers the backdrop and nothing else.
 */
export type PaletteEntry = {
  label: string;
  href: string;
  /** Grouping in the list — pages read as places, actions as verbs. */
  group: "pages" | "actions";
  /** Open in a new tab — the storefront, the docs. */
  external?: boolean;
};

type DataHit = { label: string; sub?: string; href: string };
type DataResults = { orders: DataHit[]; products: DataHit[]; clients: DataHit[] };
const NO_DATA: DataResults = { orders: [], products: [], clients: [] };

type GroupKey = keyof DataResults | "pages" | "actions";
type Row = {
  label: string;
  sub?: string;
  href: string;
  external?: boolean;
  group: GroupKey;
};

const ICONS: Record<string, typeof Package> = {
  "/admin": LayoutDashboard,
  "/admin/orders": ShoppingBag,
  "/admin/checkin": ScanLine,
  "/admin/abandoned": ShoppingCart,
  "/admin/products": Package,
  "/admin/products/new": Plus,
  "/admin/categories": Tag,
  "/admin/reviews": MessageSquare,
  "/admin/clients": Users,
  "/admin/members": BadgeCheck,
  "/admin/testimonials": Quote,
  "/admin/broadcasts": Mail,
  "/admin/broadcasts/new": Mail,
  "/admin/flows": Workflow,
  "/admin/flows/new": Workflow,
  "/admin/coupons": Tags,
  "/admin/affiliates": Gift,
  "/admin/payments": CreditCard,
  "/admin/delivery": Truck,
  "/admin/data-requests": ShieldCheck,
  "/admin/support": HelpCircle,
};

const GROUP_ICONS: Record<string, typeof Package> = {
  orders: ShoppingBag,
  products: Package,
  clients: Users,
};

function iconFor(row: Row) {
  if (row.group in GROUP_ICONS) return GROUP_ICONS[row.group]!;
  if (row.external) return ArrowUpRight;
  const exact = ICONS[row.href];
  if (exact) return exact;
  if (row.href.startsWith("/admin/settings")) return Settings;
  return CornerDownLeft;
}

export function CommandPalette({ entries }: { entries: PaletteEntry[] }) {
  const a = useAdminT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [data, setData] = useState<DataResults>(NO_DATA);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  /* Opening always starts blank — reset travels with the act, not an effect. */
  const show = useCallback(() => {
    setQuery("");
    setCursor(0);
    setData(NO_DATA);
    setOpen(true);
  }, []);

  /* ⌘K / Ctrl-K, from anywhere in the admin. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => {
          if (!v) {
            setQuery("");
            setCursor(0);
            setData(NO_DATA);
          }
          return !v;
        });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /*
   * G-then-a-letter — Shopify's go-to chords, the vocabulary its saved pages
   * document at length (G O → Orders, G P → Products…). Armed for 900ms by a
   * bare `g`, never while something is being typed into, and spent on first
   * use. Deliberately invisible chrome: the people who know it from Shopify
   * bring the habit with them, everyone else never collides with it.
   */
  useEffect(() => {
    const CHORDS: Record<string, string> = {
      h: "/admin",
      o: "/admin/orders",
      p: "/admin/products",
      c: "/admin/clients",
      a: "/admin/analytics",
      b: "/admin/broadcasts",
      f: "/admin/flows",
      d: "/admin/coupons",
      s: "/admin/settings",
    };
    let armed = 0;

    const typing = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      return (
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      );
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || typing(e)) return;
      const key = e.key.toLowerCase();
      if (key === "g") {
        armed = Date.now();
        return;
      }
      if (armed && Date.now() - armed < 900 && CHORDS[key]) {
        e.preventDefault();
        router.push(CHORDS[key]);
      }
      armed = 0;
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  useEffect(() => {
    if (!open) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    queueMicrotask(() => inputRef.current?.focus());
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open]);

  /*
   * The shop's own rows, debounced a beat behind the keystrokes and carried
   * by an AbortController so a stale response can never land over a fresher
   * one. Two characters is the floor — one letter matches everything and
   * answers nothing.
   */
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    // Below two characters nothing fetches; the render derives empty results
    // rather than an effect writing them, so no state moves synchronously.
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      fetch(`/api/admin/palette?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.json() : NO_DATA))
        .then((json: DataResults) => {
          setData(json);
          setSearching(false);
          return null;
        })
        .catch(() => {
          // An aborted fetch is the debounce working; anything else leaves
          // the pages results standing, which is a working palette.
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const hit = q
      ? entries.filter((e) => e.label.toLowerCase().includes(q))
      : entries;
    // Data rows only count once the query is long enough to have fetched —
    // shortening the query back below the floor derives them away.
    const live = q.length >= 2 ? data : NO_DATA;
    /*
     * The shop's own rows first — somebody typing three letters is far more
     * often chasing an order than a page — then places, then verbs, each
     * block in a stable order muscle memory can build on.
     */
    return [
      ...live.orders.map((d) => ({ ...d, group: "orders" as const })),
      ...live.products.map((d) => ({ ...d, group: "products" as const })),
      ...live.clients.map((d) => ({ ...d, group: "clients" as const })),
      ...hit.filter((e) => e.group === "pages"),
      ...hit.filter((e) => e.group === "actions"),
    ];
  }, [entries, query, data]);

  const go = useCallback(
    (row: Row) => {
      setOpen(false);
      if (row.external) window.open(row.href, "_blank", "noopener,noreferrer");
      else router.push(row.href);
    },
    [router],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (rows.length ? (c + 1) % rows.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (rows.length ? (c - 1 + rows.length) % rows.length : 0));
    } else if (e.key === "Enter") {
      const row = rows[cursor];
      if (row) go(row);
    }
  };

  const groupLabel: Record<GroupKey, string> = {
    orders: a.orders.title,
    products: a.products.title,
    clients: a.clients.title,
    pages: a.commandBar.pages,
    actions: a.commandBar.actions,
  };

  const groupRows = (group: GroupKey) => {
    const inGroup = rows.filter((r) => r.group === group);
    if (inGroup.length === 0) return null;
    return (
      <div key={group} className="pb-1">
        <p className="px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wide text-ink-400">
          {groupLabel[group]}
        </p>
        {inGroup.map((row) => {
          const index = rows.indexOf(row);
          const active = index === cursor;
          const Icon = iconFor(row);
          return (
            <button
              key={`${row.href}-${row.label}`}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => go(row)}
              onPointerMove={() => setCursor(index)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm transition-colors duration-100",
                active ? "bg-ink-100 text-ink-900" : "text-ink-600",
              )}
            >
              <Icon className={cn("size-4 shrink-0", active ? "text-ink-700" : "text-ink-400")} />
              <span className="min-w-0 flex-1 truncate">
                {row.label}
                {row.sub ? (
                  <span className="ms-2 text-xs text-ink-400">{row.sub}</span>
                ) : null}
              </span>
              {active ? (
                <CornerDownLeft className="size-3.5 shrink-0 text-ink-300" />
              ) : null}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <>
      {/* Desktop: an input-shaped button in the middle of the bar. */}
      <button
        type="button"
        onClick={show}
        className="focus-ring hidden h-9 w-full max-w-xl items-center gap-2 rounded-lg bg-white/[0.08] px-3 text-[13px] text-white/50 ring-1 ring-inset ring-white/10 transition hover:bg-white/[0.13] hover:text-white/70 md:flex"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate text-start">{a.commandBar.open}</span>
        <kbd className="pointer-fine:flex hidden items-center gap-0.5 rounded border border-white/15 px-1.5 py-0.5 font-sans text-[11px] text-white/40">
          ⌘K
        </kbd>
      </button>
      {/* Phone: the same door as an icon. */}
      <button
        type="button"
        onClick={show}
        aria-label={a.commandBar.open}
        className="focus-ring press grid size-9 place-items-center rounded-lg text-white/70 transition hover:bg-white/10 md:hidden pointer-coarse:size-11"
      >
        <Search className="size-5" />
      </button>

      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-50 overflow-y-auto p-4 pt-[10vh] sm:pt-[14vh]"
              role="dialog"
              aria-modal="true"
              aria-label={a.commandBar.open}
            >
              <button
                type="button"
                tabIndex={-1}
                aria-label={a.commandBar.open}
                onClick={() => setOpen(false)}
                className="animate-backdrop absolute inset-0 bg-ink-950/40 backdrop-blur-[2px] [animation-duration:120ms]"
              />
              <div className="relative mx-auto w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-ink-900/10">
                <div className="flex items-center gap-2.5 border-b border-ink-100 px-4">
                  <Search className="size-4 shrink-0 text-ink-400" />
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setCursor(0);
                    }}
                    onKeyDown={onKeyDown}
                    placeholder={a.commandBar.placeholder}
                    role="combobox"
                    aria-expanded="true"
                    aria-controls={listId}
                    aria-activedescendant={rows[cursor] ? `${listId}-${cursor}` : undefined}
                    aria-label={a.commandBar.open}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-12 w-full bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-400"
                  />
                  {searching && query.trim().length >= 2 ? (
                    <Spinner className="text-ink-400" />
                  ) : (
                    <kbd className="hidden rounded border border-ink-200 px-1.5 py-0.5 font-sans text-[11px] text-ink-400 sm:block">
                      esc
                    </kbd>
                  )}
                </div>

                <div
                  id={listId}
                  role="listbox"
                  className="max-h-[19rem] overflow-y-auto overscroll-contain p-1.5"
                >
                  {rows.length === 0 ? (
                    <p className="px-3 py-8 text-center text-sm text-ink-500">
                      {a.commandBar.empty}
                    </p>
                  ) : (
                    <>
                      {groupRows("orders")}
                      {groupRows("products")}
                      {groupRows("clients")}
                      {groupRows("pages")}
                      {groupRows("actions")}
                    </>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
