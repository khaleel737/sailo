"use client";

import { useTransition } from "react";
import { updatePaymentStatus } from "@/lib/actions/order-admin";
import { cn } from "@sailo/design-system/web/cn";
import { isSellerSettablePaymentStatus } from "@/lib/payments";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * The four states a seller may set by hand, in the order they usually happen.
 *
 * Values only. The labels come from the dictionary at render, because these
 * are the words in the one control on the orders page that decides whether an
 * order counts as paid — and they were the last English ones on it.
 */
const SETTABLE = ["unpaid", "pending", "paid", "refunded"] as const;

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
        {paymentStatus === "disputed" ? a.paymentStatus.disputed : paymentStatus}
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
        /* The 44px touch floor, for the same reason as the status select beside
           it: this one moves an order to Refunded. */
        "h-8 rounded-lg border border-ink-200 bg-white px-2 text-xs text-ink-700 pointer-coarse:h-11",
        "transition focus:border-ink-900 focus:outline-none",
        pending && "opacity-50",
      )}
    >
      {SETTABLE.map((value) => (
        <option key={value} value={value}>
          {a.paymentStatus[value]}
        </option>
      ))}
    </select>
  );
}
