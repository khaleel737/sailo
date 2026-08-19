"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Select } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * Narrowing the orders list.
 *
 * The state lives in the URL and nowhere else: a filtered list is a thing
 * sellers send to themselves and to us ("here are my unpaid bank transfers"),
 * and a filter held in React state produces a link that shows something
 * different to whoever opens it. It also means the server does the filtering,
 * which is the point — the list is capped, so a filter applied in the browser
 * would search the last hundred orders and present that as the answer.
 *
 * Status is deliberately not here any more: it became the tabs above
 * (`order-tabs.tsx`), which read and write the same `?status=` these once did,
 * so an old bookmarked filter still lands on the right tab.
 */
export function OrderFilters({
  paymentStatuses,
  methods,
  coupons,
}: {
  paymentStatuses: { value: string; label: string }[];
  methods: { value: string; label: string }[];
  coupons: string[];
}) {
  const a = useAdminT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  /*
   * The search box is the one control here that types rather than picks, so
   * it holds its own text and writes the URL on a 300ms debounce — one
   * navigation per pause, not one per keystroke. The URL stays the truth:
   * arriving with ?q= pre-fills the box, and clearing filters empties it.
   */
  const urlQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * Reconciled during render, not in an effect: when a navigation rewrites
   * `?q=` (clear filters, back button), the box must show the URL's truth in
   * the same paint.
   */
  const [lastUrlQuery, setLastUrlQuery] = useState(urlQuery);
  if (lastUrlQuery !== urlQuery) {
    setLastUrlQuery(urlQuery);
    setQuery(urlQuery);
  }

  useEffect(() => {
    // A navigation just rewrote `?q=`; any keystroke still waiting on the
    // debounce was about to write a URL that no longer exists. Cancel it.
    if (debounce.current) clearTimeout(debounce.current);
  }, [urlQuery]);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(next.size ? `${pathname}?${next}` : pathname, {
      scroll: false,
    });
  };

  const onQueryChange = (value: string) => {
    setQuery(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => set("q", value.trim()), 300);
  };

  const active = ["status", "payment", "method", "coupon", "q"].some((key) =>
    params.get(key),
  );

  const field = (
    key: string,
    label: string,
    options: { value: string; label: string }[],
  ) => (
    <label className="flex items-center gap-1.5">
      <span className="sr-only">{label}</span>
      <Select
        value={params.get(key) ?? ""}
        onChange={(e) => set(key, e.target.value)}
        aria-label={label}
        /* `h-9` is the density a mouse rewards; the 44pt touch floor comes
           from `CONTROL` in `components/ui/form.tsx`, which is why this
           override does not have to think about it. */
        className="h-9 w-auto min-w-[9rem] text-xs"
      >
        <option value="">{label}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  );

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <label className="relative min-w-0 flex-1 basis-56">
        <span className="sr-only">{a.orderList.searchLabel}</span>
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={a.orderList.searchPlaceholder}
          className="focus-ring h-9 w-full rounded-xl border border-ink-200 bg-white ps-9 pe-3 text-xs text-ink-900 shadow-xs transition placeholder:text-ink-400 focus:border-ink-900 pointer-coarse:h-11"
        />
      </label>

      {field("payment", a.orders.paymentStatusLabel, paymentStatuses)}
      {field("method", a.orders.paymentMethodLabel, methods)}
      {coupons.length > 0
        ? field(
            "coupon",
            a.orders.coupon,
            coupons.map((code) => ({ value: code, label: code })),
          )
        : null}

      {active ? (
        <button
          type="button"
          onClick={() => router.replace(pathname, { scroll: false })}
          className="focus-ring inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-ink-500 pointer-coarse:h-11 hover:bg-ink-100 hover:text-ink-900"
        >
          <X className="size-3.5" />
          {a.orders.clearFilters}
        </button>
      ) : null}
    </div>
  );
}
