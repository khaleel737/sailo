"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, MoreHorizontal, Trash2 } from "lucide-react";
import { deleteOrder } from "@/lib/actions/order-admin";
import { ConfirmDialog } from "@sailo/design-system/web";
import { cn } from "@sailo/design-system/web/cn";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * The order's ⋯ menu — the acts about the record rather than in it, same
 * grammar as the product's. The evidence pack moved here from the fulfilment
 * card's button row (it is not a fulfilment act), and delete moved up from
 * the page's bottom — still behind the same said-out-loud confirm.
 */
export function OrderMenu({ orderId }: { orderId: string }) {
  const a = useAdminT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pendingDelete, startDelete] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function confirmDelete() {
    const data = new FormData();
    data.set("id", orderId);
    startDelete(async () => {
      await deleteOrder(data);
      // The page under our feet no longer exists; the list does.
      router.push("/admin/orders");
    });
  }

  const row =
    "focus-ring flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-ink-700 transition hover:bg-ink-100 hover:text-ink-900 pointer-coarse:min-h-11";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={a.common.moreActions}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "focus-ring press flex size-8 items-center justify-center rounded-lg border border-ink-200 bg-white text-ink-500 transition hover:bg-ink-50 hover:text-ink-900 pointer-coarse:size-11",
          open && "bg-ink-50 text-ink-900",
        )}
      >
        <MoreHorizontal className="size-4" />
      </button>

      {open ? (
        <div
          role="menu"
          className="animate-pop absolute end-0 top-full z-50 mt-2 w-60 origin-top-right rounded-2xl border border-ink-200 bg-white p-1.5 shadow-xl"
        >
          <a
            href={`/api/orders/${orderId}/evidence-pack`}
            role="menuitem"
            onClick={() => setOpen(false)}
            className={row}
          >
            <FileText className="size-4 text-ink-400" />
            {a.orders.evidencePack}
          </a>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setConfirming(true);
            }}
            className={cn(row, "text-red-600 hover:bg-red-50 hover:text-red-700")}
          >
            <Trash2 className="size-4" />
            {a.orders.deleteOrder}
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={a.orderDetail.deleteTitle}
        body={a.orderDetail.deleteBody}
        confirmLabel={a.common.delete}
        cancelLabel={a.common.cancel}
        pending={pendingDelete}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
