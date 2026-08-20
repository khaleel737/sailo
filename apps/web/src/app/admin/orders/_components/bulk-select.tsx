"use client";

import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Check, Download, Loader2, PackageCheck, Truck, Wallet, X } from "lucide-react";
import {
  bulkMarkCompleted,
  bulkMarkPaid,
  bulkMarkShipped,
} from "@/lib/actions/bulk-orders";
import type { ActionState } from "@/lib/actions/shop";
import { ConfirmDialog } from "@sailo/design-system/web";
import { interpolate } from "@sailo/i18n";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * Bulk selection for the orders list — Shopify's grammar: checkboxes grow a
 * selection, and the selection bar *replaces* the tabs row rather than
 * stacking on it, because the two answer different questions ("which slice
 * am I looking at" vs "what am I about to do to these").
 *
 * The provider is the only state; the rows are still server-rendered — each
 * checkbox is a small client island reading this context, so the table
 * itself never ships to the browser twice.
 */

type Selection = {
  ids: ReadonlySet<string>;
  toggle: (id: string) => void;
  setMany: (ids: string[], on: boolean) => void;
  clear: () => void;
  notice: string | null;
  setNotice: (text: string | null) => void;
};

const Ctx = createContext<Selection | null>(null);

function useSelection(): Selection {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("bulk-select used outside its provider");
  return ctx;
}

export function BulkOrdersProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const value = useMemo<Selection>(
    () => ({
      ids,
      toggle: (id) =>
        setIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      setMany: (list, on) =>
        setIds((prev) => {
          const next = new Set(prev);
          for (const id of list) {
            if (on) next.add(id);
            else next.delete(id);
          }
          return next;
        }),
      clear: () => setIds(new Set()),
      notice,
      setNotice,
    }),
    [ids, notice],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const box =
  "size-4 shrink-0 rounded border-ink-300 accent-brand-600 focus-ring cursor-pointer";

/** One row's checkbox. */
export function RowSelect({ id }: { id: string }) {
  const a = useAdminT();
  const { ids, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      aria-label={a.orderList.selectOrder}
      checked={ids.has(id)}
      onChange={() => toggle(id)}
      className={box}
    />
  );
}

/** The header's select-all — indeterminate when the page is partly picked. */
export function PageSelect({ pageIds }: { pageIds: string[] }) {
  const a = useAdminT();
  const { ids, setMany } = useSelection();
  const onPage = pageIds.filter((id) => ids.has(id)).length;
  const all = pageIds.length > 0 && onPage === pageIds.length;
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = onPage > 0 && !all;
  }, [onPage, all]);

  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={a.orderList.selectAll}
      checked={all}
      onChange={() => setMany(pageIds, !all)}
      className={box}
    />
  );
}

/** A bar action that runs a server action over the selection. */
function BulkButton({
  icon,
  label,
  action,
  confirm,
  onDone,
  selection,
}: {
  icon: React.ReactNode;
  label: string;
  action: (prev: ActionState, data: FormData) => Promise<ActionState>;
  /** Said out loud first, when the act emails buyers or moves money. */
  confirm?: { title: string; body: string };
  onDone: (message: string) => void;
  selection: ReadonlySet<string>;
}) {
  const a = useAdminT();
  const [asking, setAsking] = useState(false);
  const [state, dispatch, pending] = useActionState(action, { ok: false });
  const [, startTransition] = useTransition();

  /* Render-time reconciliation on object identity — the save-bar pattern. */
  const [lastState, setLastState] = useState<ActionState>(state);
  if (state !== lastState) {
    setLastState(state);
    if (state.ok && state.message) {
      setAsking(false);
      onDone(state.message);
    }
  }

  const run = () => {
    const data = new FormData();
    for (const id of selection) data.append("ids", id);
    startTransition(() => dispatch(data));
  };

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => (confirm ? setAsking(true) : run())}
        className="focus-ring press inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-white/90 transition hover:bg-white/15 hover:text-white disabled:opacity-50 pointer-coarse:h-11"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : icon}
        {label}
      </button>
      {confirm ? (
        <ConfirmDialog
          open={asking}
          onClose={() => setAsking(false)}
          title={confirm.title}
          body={confirm.body}
          confirmLabel={label}
          cancelLabel={a.common.cancel}
          tone="primary"
          pending={pending}
          onConfirm={run}
        />
      ) : null}
    </>
  );
}

/**
 * Tabs or the bar — never both. The bar borrows the top bar's ink so it
 * reads as a mode, not another filter row; Escape clears the selection the
 * way it dismisses everything else.
 */
export function SelectionArea({ tabs }: { tabs: React.ReactNode }) {
  const a = useAdminT();
  const { ids, clear, notice, setNotice } = useSelection();
  const count = ids.size;

  useEffect(() => {
    if (count === 0) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && clear();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [count, clear]);

  /* The tally stays up long enough to read, then the page speaks for itself. */
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice, setNotice]);

  const done = (message: string) => {
    clear();
    setNotice(message);
  };

  if (count === 0) {
    return (
      <>
        {notice ? (
          <p
            role="status"
            className="animate-fade mb-3 flex items-center gap-1.5 text-xs font-medium text-brand-700"
          >
            <Check className="size-3.5" />
            {notice}
          </p>
        ) : null}
        {tabs}
      </>
    );
  }

  return (
    <div
      role="toolbar"
      aria-label={interpolate(a.orderList.selected, { count })}
      className="animate-fade mb-4 flex flex-wrap items-center gap-1.5 rounded-2xl bg-ink-950 px-3 py-2 text-white"
    >
      <span className="me-1.5 text-xs font-semibold tabular-nums">
        {interpolate(a.orderList.selected, { count: count.toLocaleString() })}
      </span>

      <BulkButton
        icon={<Wallet className="size-3.5" />}
        label={a.orderList.markPaidBulk}
        action={bulkMarkPaid}
        confirm={{ title: a.orderList.bulkPaidTitle, body: a.orderList.bulkPaidBody }}
        onDone={done}
        selection={ids}
      />
      <BulkButton
        icon={<Truck className="size-3.5" />}
        label={a.orderList.markShippedBulk}
        action={bulkMarkShipped}
        confirm={{ title: a.orderList.bulkShipTitle, body: a.orderList.bulkShipBody }}
        onDone={done}
        selection={ids}
      />
      <BulkButton
        icon={<PackageCheck className="size-3.5" />}
        label={a.orderList.markCompletedBulk}
        action={bulkMarkCompleted}
        onDone={done}
        selection={ids}
      />
      <a
        href={`/api/export/orders?ids=${[...ids].join(",")}`}
        className="focus-ring press inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-white/90 transition hover:bg-white/15 hover:text-white pointer-coarse:h-11"
      >
        <Download className="size-3.5" />
        {a.orderList.exportSelected}
      </a>

      <button
        type="button"
        onClick={clear}
        className="focus-ring press ms-auto inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-white/70 transition hover:bg-white/15 hover:text-white pointer-coarse:h-11"
      >
        <X className="size-3.5" />
        {a.orderList.clearSelection}
      </button>
    </div>
  );
}
