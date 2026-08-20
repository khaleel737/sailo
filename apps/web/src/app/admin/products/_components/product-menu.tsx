"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, MoreHorizontal, Trash2 } from "lucide-react";
import { deleteProduct, duplicateProduct } from "@/lib/actions/products";
import { ConfirmDialog } from "@sailo/design-system/web";
import { cn } from "@sailo/design-system/web/cn";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * The edit page's ⋯ menu — the acts that are about the record rather than in
 * it. Duplicate lands the seller inside the copy (the action redirects);
 * delete keeps the standard said-out-loud confirm. The menu closes on
 * outside-press and Escape like the account menu, whose grammar this borrows.
 *
 * Duplicate's refusal (the plan's product cap, mostly) renders inside the
 * open menu rather than as a toast: the seller's eyes are already here, and
 * the sentence names the plan and the number, which is the whole answer.
 */
export function ProductMenu({ productId }: { productId: string }) {
  const a = useAdminT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pendingDelete, startDelete] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  const [dupState, dupAction, dupPending] = useActionState(duplicateProduct, {
    ok: false,
  });

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
    data.set("id", productId);
    // A transition, like the order's delete button: the action's
    // revalidation lands before the push paints, so the list the seller
    // returns to no longer carries the row they just removed.
    startDelete(async () => {
      await deleteProduct(data);
      // The page under our feet no longer exists; the list does.
      router.push("/admin/products");
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
          className="animate-pop absolute end-0 top-full z-50 mt-2 w-64 origin-top-right rounded-2xl border border-ink-200 bg-white p-1.5 shadow-xl"
        >
          <form action={dupAction}>
            <input type="hidden" name="id" value={productId} />
            <button type="submit" role="menuitem" disabled={dupPending} className={row}>
              {dupPending ? (
                <Loader2 className="size-4 animate-spin text-ink-400" />
              ) : (
                <Copy className="size-4 text-ink-400" />
              )}
              {a.products.duplicate}
            </button>
          </form>
          {!dupState.ok && dupState.error ? (
            <p className="px-2.5 pb-1 pt-0.5 text-xs leading-relaxed text-red-600">
              {dupState.error}
            </p>
          ) : null}

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
            {a.products.deleteProduct}
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={a.products.deleteTitle}
        body={a.products.deleteBody}
        confirmLabel={a.common.delete}
        cancelLabel={a.common.cancel}
        pending={pendingDelete}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
