"use client";

import { useMemo, useRef, useState } from "react";
import { ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { interpolate } from "@/i18n";
import {
  combinations,
  MAX_OPTIONS,
  MAX_VARIANTS,
  normalizeOptions,
  optionKey,
  variantLabel,
} from "@/lib/variants";
import type { ProductOption, ProductVariant } from "@/db/schema";

/**
 * Options are typed as free text — "Size" with "Small, Medium, Large" — and
 * every combination of them becomes a row the seller can price and count.
 *
 * Rows are derived from the options rather than stored, so renaming an option
 * can't leave an orphan behind. Per-row edits live in a map keyed by the
 * combination, which means retyping an option value that was there a moment
 * ago brings its price and stock back with it.
 */

type Draft = {
  price: string;
  compareAt: string;
  sku: string;
  stock: string;
  available: boolean;
  image: string;
};

const BLANK: Draft = {
  price: "",
  compareAt: "",
  sku: "",
  stock: "",
  available: true,
  image: "",
};

type OptionDraft = { name: string; values: string };

function splitValues(input: string) {
  return input
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function toDrafts(variants: ProductVariant[]) {
  const map: Record<string, Draft> = {};
  for (const v of variants) {
    map[optionKey(v.options)] = {
      price: v.priceCents === null ? "" : (v.priceCents / 100).toFixed(2),
      compareAt:
        v.compareAtCents === null ? "" : (v.compareAtCents / 100).toFixed(2),
      sku: v.sku ?? "",
      stock: v.stockQuantity === null ? "" : String(v.stockQuantity),
      available: v.isAvailable,
      image: v.imageUrl ?? "",
    };
  }
  return map;
}

export function VariantEditor({
  options: initialOptions,
  variants,
  currency,
  basePrice,
  trackInventory,
  stockQuantity,
}: {
  options: ProductOption[];
  variants: ProductVariant[];
  currency: string;
  /** Shown as the placeholder, since a blank variant price inherits it. */
  basePrice: string;
  trackInventory: boolean;
  /** The product's own count, used only while it has no options. */
  stockQuantity: number | null;
}) {
  const a = useAdminT();
  const [optionDrafts, setOptionDrafts] = useState<OptionDraft[]>(
    initialOptions.length > 0
      ? initialOptions.map((o) => ({ name: o.name, values: o.values.join(", ") }))
      : [],
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    toDrafts(variants),
  );
  // Combinations the seller doesn't sell — no small pizza in that topping.
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const parsedOptions = useMemo(
    () =>
      normalizeOptions(
        optionDrafts.map((o) => ({
          name: o.name,
          values: splitValues(o.values),
        })),
      ),
    [optionDrafts],
  );

  const rows = useMemo(
    () =>
      combinations(parsedOptions)
        .map((options) => ({ options, key: optionKey(options) }))
        .filter((row) => !removed.has(row.key)),
    [parsedOptions, removed],
  );

  const draftFor = (key: string) => drafts[key] ?? BLANK;

  const setDraft = (key: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [key]: { ...draftFor(key), ...patch } }));

  const totalCombinations = combinations(parsedOptions).length;

  return (
    <div className="space-y-4">
      {/* One hidden field carries the whole option shape, so the server never
          has to re-align parallel arrays. */}
      <input type="hidden" name="options" value={JSON.stringify(parsedOptions)} />
      {rows.map((row) => {
        const draft = draftFor(row.key);
        return (
          <input
            key={`payload-${row.key}`}
            type="hidden"
            name="variants"
            value={JSON.stringify({
              options: row.options,
              price: draft.price,
              compareAt: draft.compareAt,
              sku: draft.sku,
              stock: draft.stock,
              available: draft.available,
              image: draft.image,
            })}
          />
        );
      })}

      <div className="space-y-3">
        {optionDrafts.map((option, index) => (
          <div key={index} className="flex items-end gap-2">
            <div className="w-1/3 min-w-0">
              <label className="mb-1.5 block text-xs font-medium text-ink-500">
                {a.variants.option}
              </label>
              <Input
                value={option.name}
                maxLength={40}
                placeholder={
                  index === 0
                    ? a.variants.optionNamePlaceholder
                    : a.variants.optionNamePlaceholderTwo
                }
                onChange={(e) =>
                  setOptionDrafts((prev) =>
                    prev.map((o, i) =>
                      i === index ? { ...o, name: e.target.value } : o,
                    ),
                  )
                }
              />
            </div>
            <div className="min-w-0 flex-1">
              <label className="mb-1.5 block text-xs font-medium text-ink-500">
                {a.variants.values}
              </label>
              <Input
                value={option.values}
                placeholder={
                  index === 0
                    ? a.variants.optionValuesPlaceholder
                    : a.variants.optionValuesPlaceholderTwo
                }
                onChange={(e) =>
                  setOptionDrafts((prev) =>
                    prev.map((o, i) =>
                      i === index ? { ...o, values: e.target.value } : o,
                    ),
                  )
                }
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="md"
              aria-label={`Remove option ${index + 1}`}
              onClick={() =>
                setOptionDrafts((prev) => prev.filter((_, i) => i !== index))
              }
              className="shrink-0 text-ink-400 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}

        {optionDrafts.length < MAX_OPTIONS ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              setOptionDrafts((prev) => [...prev, { name: "", values: "" }])
            }
          >
            <Plus className="size-4" />
            {optionDrafts.length === 0
              ? a.variants.addOptions
              : a.variants.addAnother}
          </Button>
        ) : null}
      </div>

      {optionDrafts.length === 0 ? (
        <p className="text-xs text-ink-500">
          {a.variants.intro}
        </p>
      ) : null}

      {/* Stock lives wherever the thing being counted is: on the product while
          it's sold as one item, on each combination once options exist. */}
      {trackInventory && rows.length === 0 ? (
        <div>
          <label
            htmlFor="stockQuantity"
            className="mb-1.5 block text-sm font-medium text-ink-800"
          >
            {a.variants.unitsInStock}
            <span className="ml-1.5 font-normal text-ink-400">
              {a.variants.unitsHint}
            </span>
          </label>
          <Input
            id="stockQuantity"
            name="stockQuantity"
            inputMode="numeric"
            defaultValue={stockQuantity ?? ""}
            placeholder="12"
            className="sm:w-40"
          />
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-ink-200">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50 text-left text-xs font-medium text-ink-500">
                <th className="px-3 py-2 w-14">{a.variants.photo}</th>
                <th className="px-3 py-2">{a.variants.variant}</th>
                <th className="px-3 py-2 w-28">
                  {interpolate(a.variants.priceIn, { currency })}
                </th>
                <th className="px-3 py-2 w-28">{a.variants.compareAt}</th>
                {trackInventory ? (
                  <th className="px-3 py-2 w-24">{a.variants.stock}</th>
                ) : null}
                <th className="px-3 py-2 w-28">{a.variants.sku}</th>
                <th className="px-3 py-2 w-20 text-center">
                  {a.variants.forSale}
                </th>
                <th className="px-3 py-2 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((row) => {
                const draft = draftFor(row.key);
                return (
                  <tr key={row.key} className={draft.available ? "" : "opacity-60"}>
                    <td className="px-3 py-2">
                      <VariantImage
                        url={draft.image}
                        label={variantLabel(row.options, parsedOptions)}
                        onChange={(image) => setDraft(row.key, { image })}
                      />
                    </td>
                    <td className="px-3 py-2 font-medium text-ink-900">
                      {variantLabel(row.options, parsedOptions)}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        inputMode="decimal"
                        value={draft.price}
                        placeholder={basePrice || "0.00"}
                        aria-label={`Price for ${variantLabel(row.options, parsedOptions)}`}
                        onChange={(e) =>
                          setDraft(row.key, { price: e.target.value })
                        }
                        className="h-9"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        inputMode="decimal"
                        value={draft.compareAt}
                        placeholder="—"
                        aria-label={`Compare-at price for ${variantLabel(row.options, parsedOptions)}`}
                        onChange={(e) =>
                          setDraft(row.key, { compareAt: e.target.value })
                        }
                        className="h-9"
                      />
                    </td>
                    {trackInventory ? (
                      <td className="px-3 py-2">
                        <Input
                          inputMode="numeric"
                          value={draft.stock}
                          placeholder="∞"
                          aria-label={`Stock for ${variantLabel(row.options, parsedOptions)}`}
                          onChange={(e) =>
                            setDraft(row.key, { stock: e.target.value })
                          }
                          className="h-9"
                        />
                      </td>
                    ) : null}
                    <td className="px-3 py-2">
                      <Input
                        value={draft.sku}
                        placeholder="—"
                        maxLength={60}
                        aria-label={`SKU for ${variantLabel(row.options, parsedOptions)}`}
                        onChange={(e) => setDraft(row.key, { sku: e.target.value })}
                        className="h-9"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={draft.available}
                        aria-label={`${variantLabel(row.options, parsedOptions)} is for sale`}
                        onChange={(e) =>
                          setDraft(row.key, { available: e.target.checked })
                        }
                        className="size-4 rounded border-ink-300 accent-ink-900"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${variantLabel(row.options, parsedOptions)}`}
                        title={a.variants.notSold}
                        onClick={() =>
                          setRemoved((prev) => new Set(prev).add(row.key))
                        }
                        className="text-ink-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {removed.size > 0 ? (
        <button
          type="button"
          onClick={() => setRemoved(new Set())}
          className="text-xs text-ink-500 underline underline-offset-2 hover:text-ink-900"
        >
          Bring back {removed.size} removed combination
          {removed.size === 1 ? "" : "s"}
        </button>
      ) : null}

      {totalCombinations >= MAX_VARIANTS ? (
        <p className="text-xs text-amber-600">
          {MAX_VARIANTS} combinations is the limit. Past that, separate products
          are easier for buyers to browse.
        </p>
      ) : null}

      {rows.length > 0 ? (
        <p className="text-xs text-ink-500">
          {a.variants.footnote}
        </p>
      ) : null}
    </div>
  );
}

/** One photo per combination — the red shirt, not the shirt. */
function VariantImage({
  url,
  label,
  onChange,
}: {
  url: string;
  label: string;
  onChange: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    const body = new FormData();
    body.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body });
      const json = await res.json();
      if (res.ok) onChange(json.url);
    } catch {
      // The row stays as it was; the seller can try again.
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="relative size-10">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-label={`Photo for ${label}`}
        className="flex size-10 items-center justify-center overflow-hidden rounded-lg border border-dashed border-ink-300 text-ink-400 transition hover:border-ink-900 hover:text-ink-900"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : url ? (
          // Not next/image: this is a preview of an arbitrary blob URL that
          // changes as the seller types, and it never reaches a buyer's page.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <ImagePlus className="size-4" />
        )}
      </button>

      {url && !busy ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={`Remove photo for ${label}`}
          className="absolute -end-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-ink-900 text-white"
        >
          <X className="size-2.5" />
        </button>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        onChange={(e) => upload(e.target.files?.[0])}
        className="hidden"
      />
    </div>
  );
}
