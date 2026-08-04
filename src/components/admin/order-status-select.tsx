"use client";

import { useTransition } from "react";
import { updateOrderStatus } from "@/lib/actions/orders";
import { cn } from "@/lib/utils";

const STATUSES = ["new", "contacted", "fulfilled", "cancelled"] as const;

export function OrderStatusSelect({
  orderId,
  status,
}: {
  orderId: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      defaultValue={status}
      disabled={pending}
      aria-label="Order status"
      onChange={(event) => {
        const data = new FormData();
        data.set("id", orderId);
        data.set("status", event.target.value);
        startTransition(() => updateOrderStatus(data));
      }}
      className={cn(
        "h-8 rounded-lg border border-ink-200 bg-white px-2 text-xs capitalize text-ink-700",
        "transition focus:border-ink-900 focus:outline-none",
        pending && "opacity-50",
      )}
    >
      {STATUSES.map((s) => (
        <option key={s} value={s} className="capitalize">
          {s}
        </option>
      ))}
    </select>
  );
}
