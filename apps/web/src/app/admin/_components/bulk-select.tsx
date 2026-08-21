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
import { Check, Loader2, X } from "lucide-react";
import type { ActionState } from "@/lib/actions/shop";
import { ConfirmDialog } from "@sailo/design-system/web";
import { interpolate } from "@sailo/i18n";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * Bulk selection for a list page — Shopify's grammar: checkboxes grow a
 * selection, and the selection bar *replaces* whatever normally sits above
 * the table rather than stacking on it, because the two answer different
 * questions ("which slice am I looking at" vs "what am I about to do to
 * these").
 *
 * Generic on purpose: orders grew this first and products wanted the same
 * thing, and two copies of a selection model is how one of them learns
 * Escape-to-clear and the other doesn't. What differs per page — the row
 * checkbox's accessible name, and which buttons the bar carries — comes in
 * as props; everything else is this file.
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

export function BulkSelectProvider({ children }: { children: React.ReactNode }) {
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

/** One row's checkbox. The label names the row's kind — "Select order". */
export function RowSelect({ id, label }: { id: string; label: string }) {
  const { ids, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      aria-label={label}
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

/** The bar's shared item look — buttons and the export link wear the same. */
export const barItem =
  "focus-ring press inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-white/90 transition hover:bg-white/15 hover:text-white disabled:opacity-50 pointer-coarse:h-11";

/** A bar action that runs a server action over the selection. */
export function BulkButton({
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
  /** Said out loud first, when the act emails buyers, moves money or deletes. */
  confirm?: { title: string; body: string; tone?: "danger" | "primary" };
  onDone: (message: string) => void;
  selection: ReadonlySet<string>;
}) {
  const a = useAdminT();
  const [asking, setAsking] = useState(false);
  const [state, dispatch, pending] = useActionState(action, { ok: false });
  const [, startTransition] = useTransition();

  /*
   * Completion by state identity, reported from an effect — not the save-bar's
   * render-time reconciliation, deliberately. `onDone` clears the *provider's*
   * selection, and setting another component's state mid-render is the
   * "cannot update a component while rendering a different component" error
   * the orders bar used to log on every bulk action. An effect runs after the
   * commit, where reaching the provider is legal.
   */
  const reported = useRef<ActionState>(state);
  useEffect(() => {
    if (state === reported.current) return;
    reported.current = state;
    if (state.ok && state.message) {
      setAsking(false);
      onDone(state.message);
    }
  }, [state, onDone]);

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
        className={barItem}
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
          tone={confirm.tone ?? "primary"}
          pending={pending}
          onConfirm={run}
        />
      ) : null}
    </>
  );
}

/**
 * The fallback or the bar — never both. The bar borrows the top bar's ink so
 * it reads as a mode, not another filter row; Escape clears the selection the
 * way it dismisses everything else. The page supplies the buttons; count,
 * clearing and the after-action notice live here.
 */
export function SelectionArea({
  fallback,
  actions,
}: {
  /** What stands in the bar's place while nothing is selected — tabs, or nothing. */
  fallback?: React.ReactNode;
  actions: (ctx: {
    selection: ReadonlySet<string>;
    done: (message: string) => void;
  }) => React.ReactNode;
}) {
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
        {fallback}
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

      {actions({ selection: ids, done })}

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
