"use client";

import { Camera, X } from "lucide-react";
import { Field, Select } from "@sailo/design-system/web";
import { CURRENCY_CODES, currencyLabel } from "@sailo/core/currency";
import { SHOP_ACCENT_PRESETS } from "@/lib/shop-accents";
import { interpolate } from "@sailo/i18n";
import type { Dictionary } from "@sailo/i18n";
import type { SetField, Values } from "./onboarding.types";

/*
 * The photo circle takes a dropped file, deliberately without any drag
 * styling — the affordance is the circle itself, and this screen's look is
 * settled. `preventDefault` on dragover is what makes the drop land on the
 * circle instead of the browser navigating to the image.
 */
const allowDrop = (e: React.DragEvent) => e.preventDefault();

/*
 * The last step is decorating, not data entry. By now the seller has given us
 * a link and a name; this screen hands something back — their colour and photo
 * landing on the preview as they pick them. The one remaining question with a
 * wrong answer, the currency, sits below the fun ones.
 */
export function CustomizeStep({
  values,
  set,
  setAccent,
  t,
  locale,
  photoUrl,
  photoError,
  onPickPhoto,
  onDropPhoto,
  onRemovePhoto,
}: {
  values: Values;
  set: SetField;
  /** Swatches carry a colour, not an input event, so they get their own lane. */
  setAccent: (color: string) => void;
  t: Dictionary;
  locale: string;
  /** Object URL of the picked photo, or null while there is none. */
  photoUrl: string | null;
  photoError: string | null;
  onPickPhoto: () => void;
  /** A file dragged onto the circle — same intake as the picker. */
  onDropPhoto: (file: File) => void;
  onRemovePhoto: () => void;
}) {
  const accent = values.accentColor.toLowerCase();

  const takeDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = Array.from(e.dataTransfer.files).find((f) =>
      /^image\/(jpeg|png|webp|gif|avif)$/.test(f.type),
    );
    if (file) onDropPhoto(file);
  };

  return (
    <>
      <Field label={t.onboarding.themeColor}>
        <div className="flex flex-wrap items-center gap-2">
          {SHOP_ACCENT_PRESETS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setAccent(color)}
              aria-label={interpolate(t.onboarding.useColor, { color })}
              aria-pressed={accent === color}
              className={`size-8 rounded-full transition pointer-coarse:size-11 ${
                accent === color
                  ? "ring-2 ring-ink-900 ring-offset-2"
                  : "hover:scale-110"
              }`}
              style={{ backgroundColor: color }}
            />
          ))}
          {/* Also the form control for the accent: swatch clicks land in state,
              state lands here, and this input's name is what submits. */}
          <input
            type="color"
            name="accentColor"
            value={values.accentColor}
            onChange={(e) => setAccent(e.target.value)}
            aria-label={t.onboarding.customColor}
            className="size-8 cursor-pointer rounded-full border border-ink-200 bg-transparent p-0 pointer-coarse:size-11"
          />
        </div>
      </Field>

      <div className="flex items-end gap-4">
        <div className="shrink-0">
          {photoUrl ? (
            <div className="group relative" onDragOver={allowDrop} onDrop={takeDrop}>
              {/* Plain <img>: the source is an object URL of a file that never
                  left the browser, which next/image cannot optimise. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl}
                alt=""
                className="size-20 rounded-full border border-ink-200 object-cover"
              />
              <button
                type="button"
                onClick={onRemovePhoto}
                aria-label={t.onboarding.removePhoto}
                className="absolute -end-1 -top-1 flex size-6 items-center justify-center rounded-full bg-ink-900 text-white shadow-sm transition hover:bg-ink-700 pointer-coarse:size-8"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onPickPhoto}
              onDragOver={allowDrop}
              onDrop={takeDrop}
              className="flex size-20 flex-col items-center justify-center gap-1 rounded-full border border-dashed border-ink-300 text-ink-400 transition hover:border-ink-900 hover:text-ink-900"
            >
              <Camera className="size-5" />
              <span className="px-1 text-center text-[10px] font-medium leading-tight">
                {t.onboarding.uploadPhoto}
              </span>
            </button>
          )}
        </div>

        <Field label={t.onboarding.currency} htmlFor="currency" className="flex-1">
          <Select
            id="currency"
            name="currency"
            value={values.currency}
            onChange={set("currency")}
          >
            {CURRENCY_CODES.map((c) => (
              <option key={c} value={c}>
                {currencyLabel(c, locale)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {photoError ? <p className="text-xs text-red-600">{photoError}</p> : null}
    </>
  );
}
