"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteOrder } from "@/lib/actions/order-admin";
import { ConfirmDialog } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * Deleting an order, said out loud first.
 *
 * On the old list this was a bare trash icon on every row — one mis-tap from
 * removing an order, its revenue and its stock adjustment with no way back.
 * It lives at the bottom of the order's own page now, behind the standard
 * confirm, and the confirm says what actually happens rather than "are you
 * sure".
 */
export function DeleteOrderButton({ orderId }: { orderId: string }) {
  const a = useAdminT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    const data = new FormData();
    data.set("id", orderId);
    startTransition(async () => {
      await deleteOrder(data);
      // The page under our feet no longer exists; the list does.
      router.push("/admin/orders");
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-ink-400 transition hover:bg-red-50 hover:text-red-600 pointer-coarse:h-11"
      >
        <Trash2 className="size-3.5" />
        {a.orders.deleteOrder}
      </button>

      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={a.orderDetail.deleteTitle}
        body={a.orderDetail.deleteBody}
        confirmLabel={a.common.delete}
        cancelLabel={a.common.cancel}
        pending={pending}
        onConfirm={confirm}
      />
    </>
  );
}
