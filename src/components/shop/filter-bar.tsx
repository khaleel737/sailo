"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Category } from "@/db/schema";
import type { Dictionary } from "@/i18n";
import { interpolate, plural } from "@/i18n";

export function FilterBar({
  categories,
  resultCount,
  currency,
  t,
}: {
  categories: Category[];
  resultCount: number;
  currency: string;
  t: Dictionary;
}) {
  const SORTS = [
    { value: "", label: t.sort.featured },
    { value: "newest", label: t.sort.newest },
    { value: "price_asc", label: t.sort.priceAsc },
    { value: "price_desc", label: t.sort.priceDesc },
    { value: "rating", label: t.sort.rating },
  ];
  const KINDS = [
    { value: "", label: t.sort.allTypes },
    { value: "physical", label: t.sort.physical },
    { value: "digital", label: t.sort.digital },
    { value: "service", label: t.sort.services },
  ];

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const firstRender = useRef(true);

  const activeCategory = searchParams.get("category") ?? "";
  const activeKind = searchParams.get("kind") ?? "";
  const activeSort = searchParams.get("sort") ?? "";
  const activeMin = searchParams.get("min") ?? "";
  const activeMax = searchParams.get("max") ?? "";
  const inStockOnly = searchParams.get("inStock") === "1";

  const activeFilterCount =
    (activeKind ? 1 : 0) +
    (activeMin ? 1 : 0) +
    (activeMax ? 1 : 0) +
    (inStockOnly ? 1 : 0) +
    (activeSort ? 1 : 0);

  const setParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      const qs = params.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const id = setTimeout(() => {
      if (query !== (searchParams.get("q") ?? "")) {
        setParams({ q: query || null });
      }
    }, 300);
    return () => clearTimeout(id);
  }, [query, searchParams, setParams]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="text-muted pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.shop.searchPlaceholder}
            aria-label={t.shop.searchPlaceholder}
            className="surface-card h-11 w-full rounded-xl ps-9 pe-9 text-sm outline-none transition placeholder:opacity-50 focus:ring-2 focus:ring-current/10"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t.shop.clearSearch}
              className="text-muted absolute end-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md transition hover:opacity-70"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cn(
            "surface-card relative flex h-11 items-center gap-2 rounded-xl px-3.5 text-sm font-medium transition hover:opacity-80",
            open && "surface-elevated",
          )}
        >
          <SlidersHorizontal className="size-4" />
          <span className="hidden sm:inline">{t.shop.filters}</span>
          {activeFilterCount > 0 ? (
            <span className="accent-bg flex size-5 items-center justify-center rounded-full text-[11px] font-semibold">
              {activeFilterCount}
            </span>
          ) : null}
        </button>
      </div>

      {categories.length > 0 ? (
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          <CategoryChip
            label={t.shop.all}
            active={!activeCategory}
            onClick={() => setParams({ category: null })}
          />
          {categories.map((cat) => (
            <CategoryChip
              key={cat.id}
              label={cat.name}
              active={activeCategory === cat.slug}
              onClick={() =>
                setParams({
                  category: activeCategory === cat.slug ? null : cat.slug,
                })
              }
            />
          ))}
        </div>
      ) : null}

      {open ? (
        <div className="surface-card animate-rise space-y-4 rounded-2xl p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-muted mb-1.5 block text-xs font-medium uppercase tracking-wide">
                {t.shop.type}
              </span>
              <select
                value={activeKind}
                onChange={(e) => setParams({ kind: e.target.value || null })}
                className="surface-elevated h-10 w-full rounded-lg px-3 text-sm outline-none"
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-muted mb-1.5 block text-xs font-medium uppercase tracking-wide">
                {t.shop.sortBy}
              </span>
              <select
                value={activeSort}
                onChange={(e) => setParams({ sort: e.target.value || null })}
                className="surface-elevated h-10 w-full rounded-lg px-3 text-sm outline-none"
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <span className="text-muted mb-1.5 block text-xs font-medium uppercase tracking-wide">
              {interpolate(t.shop.priceRange, { currency })}
            </span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                inputMode="decimal"
                defaultValue={activeMin}
                onBlur={(e) => setParams({ min: e.target.value || null })}
                placeholder={t.shop.min}
                aria-label={t.shop.min}
                className="surface-elevated h-10 w-full rounded-lg px-3 text-sm outline-none"
              />
              <span className="text-muted text-sm">—</span>
              <input
                type="number"
                min={0}
                inputMode="decimal"
                defaultValue={activeMax}
                onBlur={(e) => setParams({ max: e.target.value || null })}
                placeholder={t.shop.max}
                aria-label={t.shop.max}
                className="surface-elevated h-10 w-full rounded-lg px-3 text-sm outline-none"
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={inStockOnly}
              onChange={(e) => setParams({ inStock: e.target.checked ? "1" : null })}
              className="size-4 rounded accent-current"
            />
            {t.shop.inStockOnly}
          </label>

          {activeFilterCount > 0 || activeCategory || query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                startTransition(() => router.replace(pathname, { scroll: false }));
              }}
              className="text-muted text-sm underline underline-offset-4 transition hover:opacity-70"
            >
              {t.shop.resetFilters}
            </button>
          ) : null}
        </div>
      ) : null}

      <p
        className={cn(
          "text-muted text-xs transition-opacity",
          isPending && "opacity-40",
        )}
        aria-live="polite"
      >
        {plural(resultCount, t.shop.itemCountOne, t.shop.itemCount)}
      </p>
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition",
        active
          ? "accent-bg"
          : "surface-card hover:opacity-70",
      )}
    >
      {label}
    </button>
  );
}
