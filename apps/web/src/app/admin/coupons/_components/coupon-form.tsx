"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { interpolate } from "@sailo/i18n";
import { useFormStatus } from "react-dom";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { saveCoupon } from "@/lib/actions/coupons";
import { bpToPercent } from "@sailo/core/pricing";
import { centsToAmount } from "@sailo/core/currency";
import { priceIn } from "@sailo/core/regional";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
} from "@sailo/design-system/web";
import type { Coupon } from "@sailo/db/schema";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { useSaveBar } from "@/app/admin/_components/save-bar";

/*
 * The capture's "Generate random code" affordance. An alphabet without
 * I/L/O/0/1: these codes get read aloud over counters and typed from
 * phone screens, and a glyph pair that looks identical costs a sale.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function randomCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]!;
  }
  return code;
}

function Submit({ isEdit }: { isEdit: boolean }) {
  const a = useAdminT();
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : isEdit ? null : (
        <Plus className="size-4" />
      )}
      {isEdit ? a.coupons.saveCoupon : a.coupons.createCoupon}
    </Button>
  );
}

export function CouponForm({
  coupon,
  currency,
  regionalCurrencies = [],
  onDone,
}: {
  coupon?: Coupon;
  currency: string;
  /** The other currencies the shop quotes — spec 53. Empty renders no extra fields. */
  regionalCurrencies?: string[];
  onDone?: () => void;
}) {
  const a = useAdminT();
  const [state, action] = useActionState(saveCoupon, { ok: false });
  const [discountType, setDiscountType] = useState(
    coupon?.discountType ?? "percent",
  );
  const formRef = useRef<HTMLFormElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  /*
   * The summary rail's soul at this form's scale (spec 07): a chip row that
   * restates the coupon as it's typed, read straight off the live form —
   * value, floor, ceiling, deadline — so the seller sees the offer they are
   * about to make, not a pile of inputs.
   */
  type Glance = {
    code: string;
    value: string;
    min: string;
    limit: string;
    until: string;
    active: boolean;
  };
  /*
   * Seeded from props (render may not touch refs), then refreshed from the
   * live form on every input — events are where the DOM may be read.
   */
  const [parts, setParts] = useState<Glance | null>(() =>
    coupon
      ? {
          code: coupon.code,
          value:
            coupon.discountType === "percent"
              ? String(bpToPercent(coupon.discountValue))
              : centsToAmount(coupon.discountValue, currency),
          min: coupon.minSubtotalCents
            ? centsToAmount(coupon.minSubtotalCents, currency)
            : "",
          limit: coupon.maxRedemptions ? String(coupon.maxRedemptions) : "",
          until: coupon.expiresAt ? coupon.expiresAt.toISOString().slice(0, 10) : "",
          active: coupon.isActive,
        }
      : null,
  );
  const refreshGlance = () => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    setParts({
      code: String(data.get("code") ?? "").toUpperCase(),
      value: String(data.get("value") ?? ""),
      min: String(data.get("minSubtotal") ?? ""),
      limit: String(data.get("maxRedemptions") ?? ""),
      until: String(data.get("expiresAt") ?? ""),
      active: data.get("isActive") === "on",
    });
  };

  const [dirty, setDirty] = useState(false);
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    if (state.ok) setDirty(false);
  }
  useSaveBar(Boolean(coupon) && dirty, {
    label: a.saveBar.unsaved,
    saving: false,
    onSave: () => formRef.current?.requestSubmit(),
    onDiscard: () => {
      formRef.current?.reset();
      setDirty(false);
      requestAnimationFrame(refreshGlance);
    },
  });

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
      <form
        ref={formRef}
        action={action}
        onInput={() => {
          setDirty(true);
          refreshGlance();
        }}
        className="space-y-4"
      >
        {coupon ? <input type="hidden" name="id" value={coupon.id} /> : null}

        {state.error ? <Alert>{state.error}</Alert> : null}
        {state.ok && state.message ? (
          <Alert tone="success">{state.message}</Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={a.common.code} htmlFor="code">
            <Input
              ref={codeRef}
              id="code"
              name="code"
              required
              defaultValue={coupon?.code ?? ""}
              placeholder={a.coupons.codePlaceholder}
              className="uppercase"
              maxLength={32}
            />
            <button
              type="button"
              onClick={() => {
                if (codeRef.current) {
                  codeRef.current.value = randomCode();
                  setDirty(true);
                  refreshGlance();
                }
              }}
              className="focus-ring mt-1.5 inline-flex items-center gap-1 rounded text-xs font-medium text-brand-700 transition hover:text-brand-800 pointer-coarse:min-h-9"
            >
              <Sparkles className="size-3" />
              {a.coupons.generateCode}
            </button>
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

        {/*
          The same two amounts, in each currency the shop quotes — spec 53.

          A **percentage** code needs nothing here unless it names a minimum
          spend: a percentage is currency-free, so 10% off works in euros with
          no second number. A **fixed** one is a number in a currency, and a
          code with no euro amount is refused in euros rather than converted —
          which is why the amount field is only offered on the fixed branch.
        */}
        {regionalCurrencies.length > 0 ? (
          <div className="space-y-4 border-t border-ink-100 pt-4">
            <p className="text-xs text-ink-500">{a.coupons.otherCurrencies}</p>
            {regionalCurrencies.map((code) => (
              <div key={code} className="grid gap-4 sm:grid-cols-2">
                {discountType === "percent" ? null : (
                  <Field label={`${a.coupons.amount} (${code})`} htmlFor={`value_${code}`}>
                    <Input
                      id={`value_${code}`}
                      name={`value_${code}`}
                      inputMode="decimal"
                      defaultValue={centsToAmount(
                        priceIn(coupon ?? { currencyPrices: {} }, code)?.price ?? null,
                        code,
                      )}
                    />
                  </Field>
                )}
                <Field
                  label={`${a.coupons.minSpend} (${code})`}
                  htmlFor={`minSubtotal_${code}`}
                  hint={a.common.optional}
                >
                  <Input
                    id={`minSubtotal_${code}`}
                    name={`minSubtotal_${code}`}
                    inputMode="decimal"
                    defaultValue={centsToAmount(
                      priceIn(coupon ?? { currencyPrices: {} }, code)?.secondary ?? null,
                      code,
                    )}
                  />
                </Field>
              </div>
            ))}
          </div>
        ) : null}

        {parts && (parts.value || parts.code) ? (
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-ink-50 px-3 py-2.5">
            {parts.code ? (
              <span className="rounded-md bg-white px-2 py-0.5 font-mono text-xs font-semibold text-ink-900 shadow-xs">
                {parts.code}
              </span>
            ) : null}
            {parts.value ? (
              <span className="rounded-md bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-900">
                {discountType === "percent"
                  ? `−${parts.value}%`
                  : `−${parts.value} ${currency}`}
              </span>
            ) : null}
            {parts.min ? (
              <span className="rounded-md bg-white px-2 py-0.5 text-xs text-ink-600 shadow-xs">
                {a.coupons.minSpend} {parts.min} {currency}
              </span>
            ) : null}
            {parts.limit ? (
              <span className="rounded-md bg-white px-2 py-0.5 text-xs text-ink-600 shadow-xs">
                {interpolate(a.coupons.usesLeftShort, { count: parts.limit })}
              </span>
            ) : null}
            {parts.until ? (
              <span className="rounded-md bg-white px-2 py-0.5 text-xs text-ink-600 shadow-xs">
                {a.common.expires} {parts.until}
              </span>
            ) : null}
            {!parts.active ? (
              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                {a.common.inactive}
              </span>
            ) : null}
          </div>
        ) : null}

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
