"use client";

import { useTransition } from "react";
import { updateOrderStatus } from "@/lib/actions/order-admin";
import { ORDER_STATUSES, orderStatusLabel } from "@sailo/core/order-status";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { cn } from "@/lib/utils";

export function OrderStatusSelect({
  orderId,
  status,
}: {
  orderId: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const a = useAdminT();

  return (
    <select
      defaultValue={status}
      disabled={pending}
      aria-label={a.orders.statusLabel}
      onChange={(event) => {
        const data = new FormData();
        data.set("id", orderId);
        data.set("status", event.target.value);
        startTransition(() => updateOrderStatus(data));
      }}
      className={cn(
        "h-8 rounded-lg border border-ink-200 bg-white px-2 text-xs text-ink-700",
        "transition focus:border-ink-900 focus:outline-none",
        pending && "opacity-50",
      )}
    >
      {ORDER_STATUSES.map((value) => (
        <option key={value} value={value}>
          {orderStatusLabel(value, a.orderStatus)}
        </option>
      ))}
    </select>
  );
}
