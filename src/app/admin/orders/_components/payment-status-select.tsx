"use client";

import { useTransition } from "react";
import { updatePaymentStatus } from "@/lib/actions/order-admin";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "unpaid", label: "Unpaid" },
  { value: "pending", label: "Payment sent" },
  { value: "paid", label: "Paid" },
  { value: "refunded", label: "Refunded" },
];

export function PaymentStatusSelect({
  orderId,
  paymentStatus,
}: {
  orderId: string;
  paymentStatus: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      defaultValue={paymentStatus}
      disabled={pending}
      aria-label="Payment status"
      onChange={(event) => {
        const data = new FormData();
        data.set("id", orderId);
        data.set("paymentStatus", event.target.value);
        startTransition(() => updatePaymentStatus(data));
      }}
      className={cn(
        "h-8 rounded-lg border border-ink-200 bg-white px-2 text-xs text-ink-700",
        "transition focus:border-ink-900 focus:outline-none",
        pending && "opacity-50",
      )}
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
