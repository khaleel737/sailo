"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { updateShop } from "@/lib/actions/shop";
import { ImageUploader } from "./image-uploader";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import {
  CURRENCIES,
  SOCIAL_PLATFORMS,
  normalizeHandle,
} from "@/lib/utils";
import type { Shop } from "@/db/schema";

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

export function SettingsForm({ shop }: { shop: Shop }) {
  const [state, action] = useActionState(updateShop, { ok: false });
  const [handle, setHandle] = useState(shop.handle);
  const [accent, setAccent] = useState(shop.accentColor);

  const socialByPlatform = new Map(shop.socials.map((s) => [s.platform, s.url]));

  return (
    <form action={action} className="space-y-5">
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.ok && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : null}

      <Card className="space-y-4 p-5">
        <h2 className="text-sm font-semibold">Identity</h2>

        <Field label="Shop link" htmlFor="handle">
          <div className="flex items-center rounded-xl border border-ink-200 bg-white transition focus-within:border-ink-900 focus-within:ring-2 focus-within:ring-ink-900/10">
            <span className="pl-3 text-sm text-ink-400">/</span>
            <input
              id="handle"
              name="handle"
              required
              minLength={3}
              maxLength={32}
              value={handle}
              onChange={(e) => setHandle(normalizeHandle(e.target.value))}
              className="h-10 flex-1 rounded-r-xl bg-transparent pr-3 text-sm font-medium text-ink-900 focus:outline-none"
            />
          </div>
        </Field>

        <Field label="Shop name" htmlFor="name">
          <Input id="name" name="name" required defaultValue={shop.name} />
        </Field>

        <Field label="Description" htmlFor="description" hint="optional">
          <Textarea
            id="description"
            name="description"
            rows={3}
            maxLength={280}
            defaultValue={shop.description ?? ""}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Profile picture" hint="shown as a circle">
            <ImageUploader
              name="avatarUrl"
              initial={shop.avatarUrl ? [shop.avatarUrl] : []}
              max={1}
            />
          </Field>

          <Field label="Logo" hint="replaces the shop name">
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
        <h2 className="text-sm font-semibold">Appearance</h2>

        <Field label="Accent colour">
          <div className="flex flex-wrap items-center gap-2">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setAccent(color)}
                aria-label={`Use ${color}`}
                aria-pressed={accent.toLowerCase() === color}
                className={`size-8 rounded-full transition ${
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
              aria-label="Custom accent colour"
              className="size-8 cursor-pointer rounded-full border border-ink-200 bg-transparent p-0"
            />
          </div>
          <input type="hidden" name="accentColor" value={accent} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Theme" htmlFor="theme">
            <Select id="theme" name="theme" defaultValue={shop.theme}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </Select>
          </Field>

          <Field label="Product layout" htmlFor="layout">
            <Select id="layout" name="layout" defaultValue={shop.layout}>
              <option value="grid">Grid</option>
              <option value="list">List</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-sm font-semibold">Orders &amp; contact</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="WhatsApp number"
            htmlFor="whatsapp"
            hint="country code, no +"
          >
            <Input
              id="whatsapp"
              name="whatsapp"
              inputMode="tel"
              defaultValue={shop.whatsapp ?? ""}
              placeholder="234801234567"
            />
          </Field>

          <Field label="Currency" htmlFor="currency">
            <Select id="currency" name="currency" defaultValue={shop.currency}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact email" htmlFor="contactEmail" hint="optional">
            <Input
              id="contactEmail"
              name="contactEmail"
              type="email"
              defaultValue={shop.contactEmail ?? ""}
            />
          </Field>

          <Field label="Location" htmlFor="location" hint="optional">
            <Input
              id="location"
              name="location"
              defaultValue={shop.location ?? ""}
              placeholder="Lagos, Nigeria"
            />
          </Field>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="text-sm font-semibold">Social links</h2>
        <p className="-mt-1 text-xs text-ink-500">
          Leave blank to hide. Icons appear under your description.
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
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="isPublished"
            defaultChecked={shop.isPublished}
            className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900"
          />
          <span>
            <span className="block text-sm font-medium">Shop is live</span>
            <span className="block text-xs text-ink-500">
              Uncheck to take your page offline. Visitors will see a 404.
            </span>
          </span>
        </label>
      </Card>

      <Submit />
    </form>
  );
}
