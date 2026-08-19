"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Card, Field, Input, Textarea } from "@sailo/design-system/web";
import { addProductCodes, generateProductCodes } from "@/lib/actions/product-codes";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { interpolate } from "@sailo/i18n";
import type { ActionState } from "@/lib/actions/shop";

/**
 * Its own component so `useFormStatus` reads *this* form's pending state.
 *
 * The hook reports the nearest enclosing form, so a button rendered beside the
 * `<form>` rather than inside it never spins — and this card has two forms, so
 * a shared one would spin both.
 */
function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="brand" loading={pending}>
      {label}
    </Button>
  );
}

/**
 * The seller's view of one product's code pool — spec 48.
 *
 * Outside the product form rather than inside it, and that is the whole
 * design. The form is one big save: every field on it is read, validated and
 * written together, and a pool is not like that — it is an *inventory*
 * movement, it happens after the product exists, and a seller topping up two
 * hundred keys must not have that ride on a form submission that could also be
 * refused for a blank title.
 *
 * **Nothing here renders a code.** Only counts. An unclaimed code in this
 * component is an unclaimed code in the RSC payload, which is the seller's
 * inventory sitting in the page source of a screen they leave open — and the
 * whole point of a pool is that each string is worth money exactly once.
 * Codes already handed out are reachable through the export, which is scoped
 * to claimed rows for the same reason.
 */
export function CodePoolCard({
  productId,
  counts,
  generated,
}: {
  productId: string;
  counts: { available: number; claimed: number; revoked: number };
  /** True when Sailo mints the codes, so there is nothing to paste. */
  generated: boolean;
}) {
  const a = useAdminT();
  const [addState, addAction] = useActionState<ActionState, FormData>(
    addProductCodes,
    { ok: false },
  );
  const [makeState, makeAction] = useActionState<ActionState, FormData>(
    generateProductCodes,
    { ok: false },
  );

  const state = makeState.message || makeState.error ? makeState : addState;

  return (
    <Card className="mt-6 space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">
          {a.productForm.poolTitle}
        </h2>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
          {interpolate(a.productForm.poolCounts, {
            available: String(counts.available),
            claimed: String(counts.claimed),
            revoked: String(counts.revoked),
          })}
        </p>
        {/*
          Said plainly rather than left to be discovered. An empty pool is a
          sold-out product — `stockQuantity` moves with the pool — and a seller
          who does not know that will read "0 sales today" as a marketing
          problem.
        */}
        {counts.available === 0 ? (
          <p className="mt-2 text-xs leading-relaxed text-amber-700">
            {a.productForm.poolEmpty}
          </p>
        ) : null}
      </div>

      {generated ? (
        <form action={makeAction} className="flex items-end gap-3">
          <input type="hidden" name="productId" value={productId} />
          <Field label={a.productForm.poolGenerateCount} htmlFor="count">
            <Input id="count" name="count" inputMode="numeric" defaultValue="50" />
          </Field>
          <SubmitButton label={a.productForm.poolGenerate} />
        </form>
      ) : (
        <form action={addAction} className="space-y-3">
          <input type="hidden" name="productId" value={productId} />
          <Field
            label={a.productForm.poolPaste}
            htmlFor="codes"
            help={a.productForm.poolPasteHint}
          >
            <Textarea id="codes" name="codes" rows={6} placeholder={"KEY-0001\nKEY-0002"} />
          </Field>
          <SubmitButton label={a.productForm.poolAdd} />
        </form>
      )}

      {state.message || state.error ? (
        <p
          className={`text-xs ${state.ok ? "text-ink-500" : "text-red-600"}`}
          role="status"
        >
          {state.message ?? state.error}
        </p>
      ) : null}

      <div className="border-t border-black/5 pt-4">
        {/*
          A link rather than a form, because the response is a file. The route
          returns claimed codes only — see `claimedCodeRows` — and the hint says
          so, because a seller who expected their unsold keys and did not get
          them should learn why here rather than filing a bug.
        */}
        <a
          href={`/admin/products/${productId}/codes.csv`}
          className="text-xs font-medium text-ink-900 underline underline-offset-2"
        >
          {a.productForm.poolExport}
        </a>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">
          {a.productForm.poolExportHint}
        </p>
      </div>
    </Card>
  );
}
