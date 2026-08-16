"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Select } from "@/components/ui";
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
 */
export function OrderFilters({
  statuses,
  paymentStatuses,
  methods,
  coupons,
}: {
  statuses: { value: string; label: string }[];
  paymentStatuses: { value: string; label: string }[];
  methods: { value: string; label: string }[];
  coupons: string[];
}) {
  const a = useAdminT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(next.size ? `${pathname}?${next}` : pathname, {
      scroll: false,
    });
  };

  const active = ["status", "payment", "method", "coupon"].some((key) =>
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
      {field("status", a.columns.status, statuses)}
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
