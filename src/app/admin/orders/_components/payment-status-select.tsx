"use client";

import { useTransition } from "react";
import { updatePaymentStatus } from "@/lib/actions/order-admin";
import { cn } from "@/lib/utils";
import { isSellerSettablePaymentStatus } from "@/lib/payments";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

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
  const a = useAdminT();
  const [pending, startTransition] = useTransition();

  /*
   * A chargeback isn't the seller's to overrule. Showing it as a dropdown
   * would both misrepresent it — `disputed` matches no option, so the browser
   * falls back to displaying the first one, "Unpaid" — and let one careless
   * change overwrite money that has already left their balance.
   */
  if (!isSellerSettablePaymentStatus(paymentStatus)) {
    return (
      <span className="inline-flex h-8 items-center rounded-lg bg-red-100 px-2 text-xs font-medium text-red-700">
        {paymentStatus === "disputed" ? "Chargeback" : paymentStatus}
      </span>
    );
  }

  return (
    <select
      defaultValue={paymentStatus}
      disabled={pending}
      aria-label={a.orders.paymentStatusLabel}
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
