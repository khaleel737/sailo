"use client";

import { useActionState, useCallback, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowLeft, ArrowRight, Link2, Palette, Store } from "lucide-react";
import { createShop } from "@/lib/actions/shop";
import {
  Alert,
  Button,
  Stepper,
} from "@sailo/design-system/web";
import { ShopDetailsStep } from "./shop-details-step";
import { CustomizeStep } from "./customize-step";
import type { Values } from "./onboarding.types";
import { HandleField } from "@/components/shared/handle-field";
import { ShopPreview } from "./shop-preview";
import { slugify } from "@sailo/core/slug";
import { normalizeHandle } from "@sailo/core/handle";
import { DEFAULT_SHOP_ACCENT } from "@/lib/shop-accents";
import type { Dictionary } from "@sailo/i18n";
import { interpolate } from "@sailo/i18n";
import { cn } from "@sailo/design-system/web/cn";

/*
 * Setting up a shop is three decisions, not one form: what the link is, what
 * the shop is called, and how it looks. Splitting them means each screen asks
 * one thing and the preview beside it can actually show the answer landing —
 * which is the whole point of the flow.
 *
 * All values live in one piece of state and every field is submitted at once
 * on the last step, so a half-finished signup never writes a half-finished
 * shop.
 */


const STEP_COUNT = 3;

/**
 * The photo, shrunk before it rides in the form.
 *
 * The upload endpoint needs a shop to write under and this form exists because
 * there is no shop yet — so the file travels inside the `createShop` action
 * itself, and server action bodies are capped at 1 MB. An avatar is drawn at
 * most a hundred pixels wide anywhere in the product, so scaling to 512px is
 * not a compromise; it is also what makes signup on a phone connection not
 * hang on a 6 MB camera photo.
 */
async function scaleToAvatar(file: File): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const encode = (type: string) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));

    // PNG keeps a logo's transparency; a photographic PNG can still come out
    // heavier than the action body allows, and those have no alpha worth
    // keeping — so anything oversized is re-encoded flat.
    const keepAlpha = /^image\/(png|gif|webp)$/.test(file.type);
    let blob = keepAlpha ? await encode("image/png") : await encode("image/jpeg");
    if (blob && blob.size > 700_000) blob = await encode("image/jpeg");
    if (!blob) return null;

    const jpeg = blob.type === "image/jpeg";
    return new File([blob], jpeg ? "avatar.jpg" : "avatar.png", {
      type: jpeg ? "image/jpeg" : "image/png",
    });
  } catch {
    return null;
  }
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    // `flex-1`, not `w-full`: this shares a flex row with the Back button, and
    // a full-width child there overflows the column instead of filling it.
    <Button type="submit" variant="brand" size="lg" loading={pending} className="flex-1">
      {label}
    </Button>
  );
}

export function OnboardingForm({
  defaultName,
  t,
  locale,
}: {
  defaultName: string;
  t: Dictionary;
  locale: string;
}) {
  const [state, action] = useActionState(createShop, { ok: false });
  const [step, setStep] = useState(0);
  const [handleUsable, setHandleUsable] = useState(false);

  const [values, setValues] = useState<Values>({
    handle: normalizeHandle(slugify(defaultName)),
    name: defaultName,
    description: "",
    location: "",
    currency: "USD",
    accentColor: DEFAULT_SHOP_ACCENT,
  });

  const set = <K extends keyof Values>(key: K) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setValues((v) => ({ ...v, [key]: event.target.value }));

  const setAccent = (accentColor: string) =>
    setValues((v) => ({ ...v, accentColor }));

  // Stable identity: HandleField reports through an effect, and a new function
  // every render would make that effect fire on every keystroke.
  const onHandleChange = useCallback(
    (handle: string) => setValues((v) => ({ ...v, handle })),
    [],
  );

  /*
   * The photo lives in this input for the whole flow, not in the step that
   * shows it — the step unmounts on Back and a file input forgets its file
   * when it unmounts. What the input ends up holding is the *scaled* file:
   * the original is read, shrunk, and written back over itself, so the form
   * submits what the preview shows.
   */
  const photoInput = useRef<HTMLInputElement>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // One intake for both doors — the file picker and a drop on the photo
  // circle land here, so a dragged photo is scaled and carried in the input
  // exactly like a picked one.
  async function acceptPhoto(file: File) {
    const input = photoInput.current;
    if (!input) return;

    setPhotoError(null);
    const scaled = await scaleToAvatar(file);
    if (!scaled) {
      input.value = "";
      setPhotoError(t.onboarding.photoError);
      return;
    }

    const holder = new DataTransfer();
    holder.items.add(scaled);
    input.files = holder.files;

    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(URL.createObjectURL(scaled));
  }

  function onPhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void acceptPhoto(file);
  }

  function removePhoto() {
    if (photoInput.current) photoInput.current.value = "";
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
    setPhotoError(null);
  }

  const steps = [t.onboarding.yourLink, t.onboarding.shopName, t.onboarding.customize];

  // Each step names what has to be true before it will let you leave.
  const canAdvance = [handleUsable, values.name.trim().length > 0, true][step];

  const isLast = step === STEP_COUNT - 1;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-12">
      <div>
        <Stepper steps={steps} current={step} className="mb-7" />

        <form action={action} className="space-y-5">
          {state.error ? <Alert>{state.error}</Alert> : null}

          <input
            ref={photoInput}
            type="file"
            name="avatar"
            accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
            onChange={onPhotoChange}
            className="hidden"
          />

          {/* Everything not on screen still rides along in the submission, so
              the action receives a whole shop however the user got here. */}
          {(Object.keys(values) as (keyof Values)[])
            .filter((key) => !(FIELDS_BY_STEP[step] ?? []).includes(key))
            .map((key) => (
              <input key={key} type="hidden" name={key} value={values[key]} />
            ))}

          <div key={step} className="animate-rise space-y-5">
            <header>
              <p className="text-xs font-medium text-brand-700">
                {interpolate(t.onboarding.stepOf, {
                  current: step + 1,
                  total: STEP_COUNT,
                })}
              </p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink-900">
                {[
                  t.onboarding.claimTitle,
                  t.onboarding.shopTitle,
                  t.onboarding.customizeTitle,
                ][step]}
              </h1>
              <p className="mt-1 text-sm leading-relaxed text-ink-500">
                {[
                  t.onboarding.claimSubtitle,
                  t.onboarding.shopSubtitle,
                  t.onboarding.customizeSubtitle,
                ][step]}
              </p>
            </header>

            {step === 0 ? (
              <HandleField
                defaultValue={values.handle}
                autoFocus
                onChange={onHandleChange}
                onResolved={setHandleUsable}
                t={t}
              />
            ) : null}

            {step === 1 ? (
              <ShopDetailsStep values={values} set={set} t={t} />
            ) : null}

            {step === 2 ? (
              <CustomizeStep
                values={values}
                set={set}
                setAccent={setAccent}
                t={t}
                locale={locale}
                photoUrl={photoUrl}
                photoError={photoError}
                onPickPhoto={() => photoInput.current?.click()}
                onDropPhoto={(file) => void acceptPhoto(file)}
                onRemovePhoto={removePhoto}
              />
            ) : null}
          </div>

          <div className="flex items-center gap-3 pt-1">
            {step > 0 ? (
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={() => setStep((s) => s - 1)}
              >
                <ArrowLeft className="size-4 rtl:rotate-180" />
                {t.common.back}
              </Button>
            ) : null}

            {isLast ? (
              <SubmitButton label={t.onboarding.createMyShop} />
            ) : (
              <Button
                type="button"
                variant="brand"
                size="lg"
                disabled={!canAdvance}
                onClick={() => setStep((s) => s + 1)}
                className="flex-1"
              >
                {t.onboarding.continue}
                <ArrowRight className="size-4 rtl:rotate-180" />
              </Button>
            )}
          </div>
        </form>
      </div>

      <aside className="lg:sticky lg:top-8 lg:self-start">
        <p className="mb-3 text-xs font-medium text-ink-400">
          {t.onboarding.preview}
        </p>
        <ShopPreview
          handle={values.handle}
          name={values.name}
          description={values.description}
          location={values.location}
          currency={values.currency}
          accentColor={values.accentColor}
          avatarUrl={photoUrl}
          locale={locale}
          fallbackName={t.onboarding.shopNameFallback}
        />
        <ul className="mt-4 space-y-2">
          {[
            { icon: Link2, done: Boolean(values.handle) && handleUsable },
            { icon: Store, done: Boolean(values.name.trim()) },
            {
              icon: Palette,
              done:
                Boolean(photoUrl) ||
                values.accentColor.toLowerCase() !== DEFAULT_SHOP_ACCENT,
            },
          ].map(({ icon: Icon, done }, i) => (
            <li key={i} className="flex items-center gap-2.5 text-xs">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-lg transition-colors duration-300",
                  done
                    ? "bg-brand-100 text-brand-700"
                    : "bg-ink-100 text-ink-300",
                )}
              >
                <Icon className="size-3.5" />
              </span>
              <span className={done ? "text-ink-700" : "text-ink-400"}>
                {steps[i]}
              </span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

/** Which values each step renders a real control for. The rest go in hidden. */
const FIELDS_BY_STEP: Record<number, (keyof Values)[]> = {
  0: ["handle"],
  1: ["name", "description", "location"],
  2: ["currency", "accentColor"],
};
