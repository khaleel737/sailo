"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Plus } from "lucide-react";
import { saveCoupon } from "@/lib/actions/coupons";
import { bpToPercent } from "@/lib/pricing";
import { centsToAmount } from "@/lib/utils";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
} from "@/components/ui";
import type { Coupon } from "@sailo/db/schema";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

function Submit({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : isEdit ? null : (
        <Plus className="size-4" />
      )}
      {isEdit ? "Save coupon" : "Create coupon"}
    </Button>
  );
}

export function CouponForm({
  coupon,
  currency,
  onDone,
}: {
  coupon?: Coupon;
  currency: string;
  onDone?: () => void;
}) {
  const a = useAdminT();
  const [state, action] = useActionState(saveCoupon, { ok: false });
  const [discountType, setDiscountType] = useState(
    coupon?.discountType ?? "percent",
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && !coupon) formRef.current?.reset();
    if (state.ok) onDone?.();
  }, [state, coupon, onDone]);

  const valueDefault = coupon
    ? coupon.discountType === "percent"
      ? String(bpToPercent(coupon.discountValue))
      : centsToAmount(coupon.discountValue, currency)
    : "";

  return (
    <Card className="p-5">
      <form ref={formRef} action={action} className="space-y-4">
        {coupon ? <input type="hidden" name="id" value={coupon.id} /> : null}

        {state.error ? <Alert>{state.error}</Alert> : null}
        {state.ok && state.message ? (
          <Alert tone="success">{state.message}</Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={a.common.code} htmlFor="code">
            <Input
              id="code"
              name="code"
              required
              defaultValue={coupon?.code ?? ""}
              placeholder={a.coupons.codePlaceholder}
              className="uppercase"
              maxLength={32}
            />
          </Field>

          <Field label={a.common.type} htmlFor="discountType">
            <Select
              id="discountType"
              name="discountType"
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value)}
            >
              <option value="percent">{a.coupons.percentOff}</option>
              <option value="fixed">{a.coupons.fixedOff}</option>
            </Select>
          </Field>

          <Field
            label={
              discountType === "percent"
                ? a.coupons.percentOff
                : `${a.coupons.amount} (${currency})`
            }
            htmlFor="value"
          >
            <Input
              id="value"
              name="value"
              inputMode="decimal"
              required
              defaultValue={valueDefault}
              placeholder={discountType === "percent" ? "10" : "5.00"}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label={`${a.coupons.minSpend} (${currency})`}
            htmlFor="minSubtotal"
            hint={a.common.optional}
          >
            <Input
              id="minSubtotal"
              name="minSubtotal"
              inputMode="decimal"
              defaultValue={
                coupon?.minSubtotalCents
                  ? centsToAmount(coupon.minSubtotalCents, currency)
                  : ""
              }
              placeholder="0.00"
            />
          </Field>

          <Field label={a.coupons.usageLimit} htmlFor="maxRedemptions" hint={a.common.optional}>
            <Input
              id="maxRedemptions"
              name="maxRedemptions"
              inputMode="numeric"
              defaultValue={coupon?.maxRedemptions ?? ""}
              placeholder={a.coupons.usageLimitPlaceholder}
            />
          </Field>

          <Field label={a.common.expires} htmlFor="expiresAt" hint={a.common.optional}>
            <Input
              id="expiresAt"
              name="expiresAt"
              type="date"
              defaultValue={
                coupon?.expiresAt
                  ? coupon.expiresAt.toISOString().slice(0, 10)
                  : ""
              }
            />
          </Field>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-ink-100 pt-4">
          <label className="flex cursor-pointer items-center gap-2.5 pointer-coarse:min-h-11">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={coupon?.isActive ?? true}
              className="size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
            />
            <span className="text-sm font-medium">{a.common.active}</span>
          </label>
          <Submit isEdit={Boolean(coupon)} />
        </div>
      </form>
    </Card>
  );
}
