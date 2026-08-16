"use client";

import { Plus, X } from "lucide-react";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { interpolate } from "@sailo/i18n";
import { Field, Input, Select } from "@sailo/design-system/web";
import type { PickerOption } from "@/lib/broadcasts/pickers";

/**
 * The offer: a code, the things it is for, and one button.
 *
 * All three are references rather than copies — an id for the coupon, ids for
 * the products — because the send resolves them at the moment it goes out. A
 * seller who fixes a price or an expiry after pressing Send has that fix
 * reach the batches still to leave, and nothing in nine hundred inboxes
 * promises something the shop stopped offering.
 *
 * Deliberately three plain controls and not a template gallery. What makes a
 * campaign work is the offer, not the layout, and every "block" a seller can
 * rearrange is another way for an email to arrive broken in Outlook.
 */
export function PromoPicker({
  couponId,
  onCouponChange,
  productIds,
  onProductsChange,
  ctaLabel,
  onCtaLabelChange,
  ctaUrl,
  onCtaUrlChange,
  coupons,
  products,
  maxProducts,
  truncated,
  disabled,
}: {
  couponId: string;
  onCouponChange: (next: string) => void;
  productIds: string[];
  onProductsChange: (next: string[]) => void;
  ctaLabel: string;
  onCtaLabelChange: (next: string) => void;
  ctaUrl: string;
  onCtaUrlChange: (next: string) => void;
  coupons: PickerOption[];
  products: PickerOption[];
  maxProducts: number;
  /** Whether the catalogue is longer than the picker can list. */
  truncated?: { count: number };
  disabled?: boolean;
}) {
  const a = useAdminT();

  const chosen = productIds
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is PickerOption => Boolean(p));

  const remaining = products.filter((p) => !productIds.includes(p.id));

  return (
    <div className="space-y-4">
      <Field
        label={a.broadcasts.discountCode}
        htmlFor="couponId"
        help={coupons.length === 0 ? a.broadcasts.noCoupons : undefined}
      >
        <Select
          id="couponId"
          value={couponId}
          onChange={(e) => onCouponChange(e.target.value)}
          disabled={disabled || coupons.length === 0}
          className="sm:w-72"
        >
          <option value="">{a.broadcasts.noDiscount}</option>
          {coupons.map((coupon) => (
            <option key={coupon.id} value={coupon.id}>
              {coupon.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label={a.broadcasts.featured}
        hint={interpolate(a.broadcasts.featuredHint, { count: maxProducts })}
        help={
          truncated
            ? interpolate(a.broadcasts.onlyRecent, { count: truncated.count })
            : undefined
        }
      >
        <div className="space-y-2">
          {chosen.length > 0 ? (
            <ul className="space-y-1.5">
              {chosen.map((product) => (
                <li
                  key={product.id}
                  className="flex items-center gap-2 rounded-xl border border-ink-200 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate text-ink-800">
                    {product.label}
                  </span>
                  {disabled ? null : (
                    <button
                      type="button"
                      onClick={() =>
                        onProductsChange(productIds.filter((id) => id !== product.id))
                      }
                      aria-label={a.broadcasts.remove}
                      className="focus-ring flex size-6 items-center justify-center rounded-lg text-ink-400 transition hover:bg-ink-100 hover:text-ink-900"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {!disabled && productIds.length < maxProducts && remaining.length > 0 ? (
            <div className="flex items-center gap-2">
              <Select
                value=""
                onChange={(e) => {
                  if (e.target.value) onProductsChange([...productIds, e.target.value]);
                }}
                aria-label={a.broadcasts.addProduct}
                className="h-10 sm:w-72"
              >
                <option value="">{a.broadcasts.addProduct}</option>
                {remaining.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.label}
                  </option>
                ))}
              </Select>
              <Plus className="size-4 text-ink-300" aria-hidden />
            </div>
          ) : null}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={a.broadcasts.buttonLabel} htmlFor="ctaLabel">
          <Input
            id="ctaLabel"
            value={ctaLabel}
            onChange={(e) => onCtaLabelChange(e.target.value)}
            maxLength={40}
            disabled={disabled}
            placeholder={a.broadcasts.buttonLabelPlaceholder}
          />
        </Field>
        <Field
          label={a.broadcasts.buttonUrl}
          htmlFor="ctaUrl"
          help={a.broadcasts.buttonUrlHint}
        >
          <Input
            id="ctaUrl"
            type="url"
            inputMode="url"
            value={ctaUrl}
            onChange={(e) => onCtaUrlChange(e.target.value)}
            disabled={disabled}
            placeholder="https://"
          />
        </Field>
      </div>
    </div>
  );
}
