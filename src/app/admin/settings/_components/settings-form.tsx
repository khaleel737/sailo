"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { updateShop } from "@/lib/actions/shop";
import { ImageUploader } from "@/app/admin/products/_components/image-uploader";
import { HandleField } from "@/components/shared/handle-field";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
  Switch,
  Textarea,
} from "@/components/ui";
import {
  CURRENCIES,
  SOCIAL_PLATFORMS,
} from "@/lib/utils";

import { LOCALES } from "@/i18n/config";
import type { Shop } from "@/db/schema";
import type { Dictionary } from "@/i18n";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

const PRESET_COLORS = [
  "#111111", "#4f46e5", "#0ea5e9", "#059669",
  "#d97706", "#dc2626", "#db2777", "#7c3aed",
];

const SOCIAL_LABELS: Record<string, string> = {
  x: "X (Twitter)",
  tiktok: "TikTok",
  youtube: "YouTube",
  whatsapp: "WhatsApp",
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      Save changes
    </Button>
  );
}

export function SettingsForm({ shop, t }: { shop: Shop; t: Dictionary }) {
  const a = useAdminT();
  const [state, action] = useActionState(updateShop, { ok: false });
  const [accent, setAccent] = useState(shop.accentColor);

  const socialByPlatform = new Map(shop.socials.map((s) => [s.platform, s.url]));

  return (
    <form action={action} className="space-y-5">
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.ok && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : null}

      <Card className="space-y-4 p-5">
        <h2 className="text-sm font-semibold text-ink-900">{a.settings.identity}</h2>

        <HandleField
          label={t.handle.label}
          prefix="sailo.store/"
          defaultValue={shop.handle}
          currentHandle={shop.handle}
          t={t}
        />

        <Field label={a.settings.shopName} htmlFor="name">
          <Input id="name" name="name" required defaultValue={shop.name} />
        </Field>

        <Field
          label={a.settings.shopDescription}
          htmlFor="description"
          hint={a.common.optional}
        >
          <Textarea
            id="description"
            name="description"
            rows={3}
            maxLength={280}
            defaultValue={shop.description ?? ""}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={a.settings.profilePicture} hint={a.settings.profilePictureHint}>
            <ImageUploader
              name="avatarUrl"
              initial={shop.avatarUrl ? [shop.avatarUrl] : []}
              max={1}
            />
          </Field>

          <Field label={a.settings.logo} hint={a.settings.logoHint}>
            <ImageUploader
              name="logoUrl"
              initial={shop.logoUrl ? [shop.logoUrl] : []}
              max={1}
              aspect="wide"
            />
          </Field>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-sm font-semibold text-ink-900">{a.settings.appearance}</h2>

        <Field label={a.settings.accentColour}>
          <div className="flex flex-wrap items-center gap-2">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setAccent(color)}
                aria-label={`Use ${color}`}
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

      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">{a.settings.ordersContact}</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Ways to order live in{" "}
            <Link
              href="/admin/payments"
              className="font-medium text-ink-700 underline underline-offset-2"
            >
            {a.payments.title}
            </Link>
            .
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={a.settings.currency} htmlFor="currency">
            <Select id="currency" name="currency" defaultValue={shop.currency}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={t.settings.storefrontLanguage}
            htmlFor="locale"
            hint={t.settings.storefrontLanguageHint}
          >
            <Select id="locale" name="locale" defaultValue={shop.locale ?? ""}>
              <option value="">
                {a.settings.matchBrowser}
              </option>
              {LOCALES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.native} — {l.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={a.settings.contactEmail}
            htmlFor="contactEmail"
            hint={a.common.optional}
          >
            <Input
              id="contactEmail"
              name="contactEmail"
              type="email"
              defaultValue={shop.contactEmail ?? ""}
            />
          </Field>
        </div>

        <Field
          label={a.settings.location}
          htmlFor="location"
          hint={a.common.optional}
        >
          <Input
            id="location"
            name="location"
            defaultValue={shop.location ?? ""}
            placeholder={a.settings.locationPlaceholder}
          />
        </Field>

        <div className="border-t border-ink-200 pt-4">
          <Switch
            name="collectAddress"
            defaultChecked={shop.collectAddress}
            label={a.settings.collectAddress}
            description={a.settings.collectAddressBody}
          />
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">{a.settings.tax}</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Only turn this on if you are registered to charge it. Existing
            orders keep the rate they were placed at.
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
          <input
            type="checkbox"
            name="taxEnabled"
            defaultChecked={shop.taxEnabled}
            className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
          />
          <span>
            <span className="block text-sm font-medium">{a.settings.chargeTax}</span>
            <span className="block text-xs text-ink-500">
              {a.settings.chargeTaxBody}
            </span>
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={a.settings.taxName}
            htmlFor="taxName"
            hint={a.settings.taxNameHint}
          >
            <Input
              id="taxName"
              name="taxName"
              defaultValue={shop.taxName}
              placeholder="VAT"
              maxLength={40}
            />
          </Field>

          <Field
            label={a.settings.taxRate}
            htmlFor="taxRate"
            hint={a.settings.taxRateHint}
          >
            <Input
              id="taxRate"
              name="taxRate"
              type="number"
              min={0}
              max={100}
              step="0.01"
              inputMode="decimal"
              defaultValue={
                shop.taxRateBp ? String(shop.taxRateBp / 100) : ""
              }
              placeholder="20"
            />
          </Field>
        </div>

        <Field label={a.settings.taxShown} htmlFor="taxInclusive">
          <Select
            id="taxInclusive"
            name="taxInclusive"
            defaultValue={shop.taxInclusive ? "inclusive" : "exclusive"}
          >
            <option value="exclusive">
              {a.settings.taxExclusive}
            </option>
            <option value="inclusive">
              {a.settings.taxInclusive}
            </option>
          </Select>
        </Field>

        <label className="flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
          <input
            type="checkbox"
            name="taxOnDelivery"
            defaultChecked={shop.taxOnDelivery}
            className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
          />
          <span>
            <span className="block text-sm font-medium">
              {a.settings.taxOnDelivery}
            </span>
            <span className="block text-xs text-ink-500">
              {a.settings.taxOnDeliveryBody}
            </span>
          </span>
        </label>

        <Field
          label={a.settings.taxId}
          htmlFor="taxId"
          hint={a.settings.taxIdHint}
        >
          <Input
            id="taxId"
            name="taxId"
            defaultValue={shop.taxId ?? ""}
            placeholder={a.settings.taxIdPlaceholder}
          />
        </Field>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="text-sm font-semibold text-ink-900">{a.settings.socialLinks}</h2>
        <p className="-mt-1 text-xs text-ink-500">
          {a.settings.socialLinksBody}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {SOCIAL_PLATFORMS.map((platform) => (
            <Field
              key={platform}
              label={
                SOCIAL_LABELS[platform] ??
                platform.charAt(0).toUpperCase() + platform.slice(1)
              }
              htmlFor={`social_${platform}`}
            >
              <Input
                id={`social_${platform}`}
                name={`social_${platform}`}
                defaultValue={socialByPlatform.get(platform) ?? ""}
                placeholder={`${platform}.com/yourname`}
              />
            </Field>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <Switch
          name="isPublished"
          defaultChecked={shop.isPublished}
          label={a.settings.shopIsLive}
          description={a.settings.shopIsLiveBody}
        />
      </Card>

      <Submit />
    </form>
  );
}
