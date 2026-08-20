"use client";

import { useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { updatePaymentStatus } from "@/lib/actions/order-admin";
import { Button } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * The one button a manual-rail order is waiting for.
 *
 * A WhatsApp or bank-transfer sale settles between two people; the platform
 * only learns about it when the seller says so. That saying-so used to be a
 * small dropdown set to "Paid" — findable, but never *offered*. On an order
 * that's still waiting, this is the order's next step, so it looks like one:
 * a primary button, full width, above the chase links.
 *
 * Same server action as the dropdown — one writer, two doors.
 */
export function ConfirmPaymentButton({ orderId }: { orderId: string }) {
  const a = useAdminT();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      className="w-full"
      disabled={pending}
      onClick={() => {
        const data = new FormData();
        data.set("id", orderId);
        data.set("paymentStatus", "paid");
        startTransition(() => updatePaymentStatus(data));
      }}
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Check className="size-4" />
      )}
      {a.orders.confirmPayment}
    </Button>
  );
}
