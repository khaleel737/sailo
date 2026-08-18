"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { X } from "lucide-react";
import { Alert, Button, Input, Select } from "@sailo/design-system/web";
import type { ActionState } from "@sailo/core/action-state";
import { PAID_PLAN_IDS, PLANS } from "@sailo/core/plans";
import { bulkAccountAction } from "@/lib/actions/bulk";
/*
 * The vocabulary comes from a plain module, not from the action's. A
 * `"use server"` file may export async functions and nothing else — importing
 * `BULK_LIMIT` from there is what made the whole action module export nothing
 * and the bar post into the void.
 */
import {
  BULK_LIMIT,
  BULK_OPERATION_ORDER,
  BULK_OPERATIONS,
} from "@/lib/bulk-operations";

const IDLE: ActionState = { ok: false };

/**
 * The sweep bar: pick some shops, say what to do and why, once.
 *
 * ─── WHY THE TABLE IS INSIDE THE FORM ────────────────────────────────────────
 * The checkboxes are server-rendered into the rows and named `shopId`, so the
 * selection *is* the form's own state and nothing in JavaScript tracks it. A
 * React-held `Set` of ids would have to be kept in step with a table that is
 * re-rendered by the server on every filter change, page change and
 * revalidation — and the failure mode of getting that wrong is a sweep applied
 * to a shop nobody selected.
 *
 * This component's only state is the count, which it reads off the form when
 * something changes, and which exists purely so the bar can say a number.
 *
 * ─── WHAT IT REFUSES TO DO ───────────────────────────────────────────────────
 * The bar stays hidden until something is selected, so a page nobody is
 * sweeping looks exactly as it did before. The reason field is required by the
 * action, not just by the markup — and the destructive operations get a
 * confirm step, because the whole risk of a bulk tool is that it makes a large
 * act feel like a small one.
 */

function Submit({ destructive, count }: { destructive: boolean; count: number }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={destructive ? "danger" : "primary"}
      loading={pending}
      disabled={count === 0 || count > BULK_LIMIT}
    >
      Apply to {count}
    </Button>
  );
}

export function BulkBar({
  children,
  /** Which operations this staff member's role allows. */
  may,
}: {
  children: React.ReactNode;
  may: { suspend: boolean; grant: boolean; note: boolean };
}) {
  const [state, action] = useActionState(bulkAccountAction, IDLE);
  const form = useRef<HTMLFormElement>(null);
  const [count, setCount] = useState(0);
  const [operation, setOperation] = useState("");

  /*
   * Filtered from the same table the action reads its capability from, so the
   * menu cannot come to offer something the server refuses. Adding an operation
   * is one edit in `bulk-operations.ts`, not two that have to agree.
   */
  const allowed = BULK_OPERATION_ORDER.filter((key) => {
    const needed = BULK_OPERATIONS[key].capability;
    if (needed === "notes:write") return may.note;
    if (needed === "billing:grant") return may.grant;
    return may.suspend;
  });

  const chosen = operation ? BULK_OPERATIONS[operation as keyof typeof BULK_OPERATIONS] : undefined;

  /*
   * Counted off the DOM rather than tracked in state. The rows are server
   * components and re-render underneath this on every filter change; a
   * JavaScript copy of the selection would be the thing that goes stale.
   */
  function recount() {
    const boxes = form.current?.querySelectorAll<HTMLInputElement>(
      'input[name="shopId"]:checked',
    );
    setCount(boxes?.length ?? 0);
  }

  function clear() {
    for (const box of form.current?.querySelectorAll<HTMLInputElement>(
      'input[name="shopId"]',
    ) ?? []) {
      box.checked = false;
    }
    setCount(0);
  }

  // Nothing to sweep with, so nothing to render but the table.
  if (!may.suspend && !may.grant && !may.note) return <>{children}</>;

  return (
    <form ref={form} action={action} onChange={recount}>
      {children}

      {/*
        Sticky to the bottom of the viewport rather than to the top of the
        table: the rows you are selecting are what you are looking at, and a bar
        that covers them is a bar that gets in the way of the one job it has.
      */}
      {count > 0 ? (
        <div className="sticky bottom-4 z-20 mt-4">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-2xl border border-ink-800 bg-ink-950 p-3 shadow-xl">
            <span className="tabular ps-1 text-sm font-medium text-white">
              {count} selected
            </span>

            <button
              type="button"
              onClick={clear}
              className="focus-ring grid size-7 place-items-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white"
              aria-label="Clear selection"
            >
              <X className="size-4" />
            </button>

            <Select
              name="operation"
              value={operation}
              onChange={(e) => setOperation(e.target.value)}
              aria-label="What to do"
              required
              className="h-9 w-auto min-w-44"
            >
              <option value="">Choose…</option>
              {allowed.map((key) => (
                <option key={key} value={key}>
                  {BULK_OPERATIONS[key].label}
                </option>
              ))}
            </Select>

            {operation === "comp" ? (
              <Select name="plan" aria-label="Which plan" required className="h-9 w-auto">
                {PAID_PLAN_IDS.map((id) => (
                  <option key={id} value={id}>
                    {PLANS[id].name}
                  </option>
                ))}
              </Select>
            ) : null}

            {/*
              Required on every operation, not only the destructive ones. The
              risk of a sweep is that it makes a large act feel like a small
              one, and being made to type why is the cheapest brake available.
            */}
            <Input
              name="reason"
              required
              maxLength={500}
              placeholder="Why — this goes on every one of them"
              aria-label="Why"
              className="h-9 min-w-0 flex-1 basis-56"
            />

            <Submit destructive={chosen?.destructive ?? false} count={count} />
          </div>

          {count > BULK_LIMIT ? (
            <div className="mx-auto mt-2 max-w-4xl">
              <Alert tone="error">
                {count} shops selected. {BULK_LIMIT} at a time — narrow the
                filter and go again. A sweep that quietly did the first{" "}
                {BULK_LIMIT} would be worse than one that refuses.
              </Alert>
            </div>
          ) : null}

          {state.error ? (
            <div className="mx-auto mt-2 max-w-4xl">
              <Alert tone="error">{state.error}</Alert>
            </div>
          ) : null}
        </div>
      ) : null}

      {/*
        The result stays after the selection clears, because a sweep's report is
        the only place the count and the skips are stated — and the rows it
        acted on have already been re-rendered out from under it.
      */}
      {state.ok && state.message ? (
        <div className="mt-4">
          <Alert tone="success">{state.message}</Alert>
        </div>
      ) : null}
    </form>
  );
}

/**
 * One row's checkbox.
 *
 * Server-rendered inside the table, so the selection lives in the form rather
 * than in React state. Deliberately not exported from a client boundary of its
 * own — it is a plain input, and making it a component only buys the label.
 */
export function BulkCheckbox({ shopId, label }: { shopId: string; label: string }) {
  /*
   * The box stays 16px — that is what a checkbox looks like — and the *label*
   * around it carries the hit area. A `size-4` input alone is a 16×16 target,
   * which fails every touch guideline and is fiddly with a mouse too; padding
   * the input itself would draw a 44px checkbox, which is not a checkbox.
   */
  return (
    <label className="-m-2 inline-flex cursor-pointer items-center justify-center p-2 pointer-coarse:-m-3 pointer-coarse:p-3">
      <input
        type="checkbox"
        name="shopId"
        value={shopId}
        aria-label={`Select ${label}`}
        className="focus-ring size-4 shrink-0 rounded border-ink-300 text-ink-900 accent-ink-900"
      />
    </label>
  );
}
