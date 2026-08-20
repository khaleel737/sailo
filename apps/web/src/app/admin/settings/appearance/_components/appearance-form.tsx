"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { updateShopAppearance } from "@/lib/actions/shop";
import { interpolate } from "@sailo/i18n";
import { Alert, Button, Card, Field, Select } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { useSaveBar } from "@/app/admin/_components/save-bar";
import type { Shop } from "@sailo/db/schema";

/**
 * How the storefront looks — its own settings section now.
 *
 * This card used to sit second inside Shop details, where a seller changing
 * their accent colour scrolled past their tax setup to reach Save. Theme is
 * a decision made alone and revisited alone (the user's words: "theme is
 * alone"), so it gets its own room, its own Save, and an UPDATE that names
 * only these three columns.
 */
const PRESET_COLORS = [
  "#111111", "#4f46e5", "#0ea5e9", "#059669",
  "#d97706", "#dc2626", "#db2777", "#7c3aed",
];

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

export function AppearanceForm({ shop }: { shop: Shop }) {
  const a = useAdminT();
  const [state, action, pending] = useActionState(updateShopAppearance, { ok: false });
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);

  /*
   * A successful save is the one thing that makes the form clean again —
   * reconciled during render so the bar clears in the same paint. Tracked by
   * state identity, not the ok flag: `useActionState` returns a fresh object
   * per completed action, while `ok` stays true across consecutive saves —
   * a flag comparison cleared the bar once and never again.
   */
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    if (state.ok) setDirty(false);
  }

  useSaveBar(dirty, {
    label: a.saveBar.unsaved,
    saving: pending,
    onSave: () => formRef.current?.requestSubmit(),
    onDiscard: () => {
      formRef.current?.reset();
      setDirty(false);
    },
  });

  const [accent, setAccent] = useState(shop.accentColor);

  return (
    <form ref={formRef} action={action} onInput={() => setDirty(true)} className="space-y-5">
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.ok && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : null}

      <Card className="space-y-4 p-5">
        <Field label={a.settings.accentColour}>
          <div className="flex flex-wrap items-center gap-2">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => {
                  setAccent(color);
                  setDirty(true);
                }}
                aria-label={interpolate(a.settings.useColour, { color })}
                aria-pressed={accent.toLowerCase() === color}
                className={`size-8 rounded-full transition pointer-coarse:size-11 ${
                  accent.toLowerCase() === color
                    ? "ring-2 ring-ink-900 ring-offset-2"
                    : "hover:scale-110"
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
            <input
              type="color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              aria-label={a.settings.customAccent}
              className="size-8 cursor-pointer rounded-full border border-ink-200 bg-transparent p-0 pointer-coarse:size-11"
            />
          </div>
          <input type="hidden" name="accentColor" value={accent} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={a.settings.theme} htmlFor="theme">
            <Select id="theme" name="theme" defaultValue={shop.theme}>
              <option value="light">{a.settings.themeLight}</option>
              <option value="dark">{a.settings.themeDark}</option>
            </Select>
          </Field>

          <Field label={a.settings.productLayout} htmlFor="layout">
            <Select id="layout" name="layout" defaultValue={shop.layout}>
              <option value="grid">{a.settings.layoutGrid}</option>
              <option value="list">{a.settings.layoutList}</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Submit label={a.common.saveChanges} />
    </form>
  );
}
