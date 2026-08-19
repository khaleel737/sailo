"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { updateShop } from "@/lib/actions/shop";
import { interpolate } from "@sailo/i18n";
import {
  Alert,
  Button,
  Card,
  Field,
  Select,
} from "@sailo/design-system/web";
import type { Shop } from "@sailo/db/schema";
import type { CurrencyGaps } from "@/lib/queries/regional";
import type { Dictionary } from "@sailo/i18n";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { IdentityCard } from "./identity-card";
import { OrdersContactCard } from "./orders-contact-card";
import { PublishCard } from "./publish-card";
import { SocialLinksCard } from "./social-links-card";
import { ComplianceCard } from "./compliance-card";
import { TaxCard } from "./tax-card";
import { InvoicingCard } from "./invoicing-card";
import { TrackingCard } from "./tracking-card";
import { BookingCard } from "./booking-card";
import { CalendarSyncCard } from "./calendar-sync-card";
import { CurrenciesCard } from "./currencies-card";
import { NotificationsCard } from "./notifications-card";
import { hoursOf } from "@sailo/commerce/booking";

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

export function SettingsForm({
  shop,
  t,
  accountEmail,
  marketingOptIn,
  currencyGaps,
}: {
  shop: Shop;
  t: Dictionary;
  /** Where seller notifications go when no contact address is set. */
  accountEmail: string;
  /** Whether Sailo's own product mail is still switched on for this account. */
  marketingOptIn: boolean;
  /**
   * What each ticked currency is still missing before it can be quoted —
   * spec 53. Empty for every shop that has ticked none, which is every shop
   * the day this ships.
   */
  currencyGaps: CurrencyGaps[];
}) {
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

      <IdentityCard shop={shop} t={t} />

      <Card className="space-y-4 p-5">
        <h2 className="text-sm font-semibold text-ink-900">{a.settings.appearance}</h2>

        <Field label={a.settings.accentColour}>
          <div className="flex flex-wrap items-center gap-2">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setAccent(color)}
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

      <OrdersContactCard shop={shop} t={t} />

      {/* Above tax rather than below it: which currencies a shop quotes is a
          decision about the price on the card, and tax is a decision about
          what is added to it. Reading them the other way round invites the
          idea that a second currency has a second tax rate, which it does
          not — a rate is a percentage and a percentage has no currency. */}
      <CurrenciesCard shop={shop} gaps={currencyGaps} />

      <TaxCard shop={shop} />

      {/* Directly under tax: the invoice is where the tax decision is printed,
          and the issuer block beneath it is what makes that printing valid. */}
      <InvoicingCard shop={shop} />

      <ComplianceCard shop={shop} />

      <BookingCard shop={shop} hours={hoursOf(shop.bookingHours)} />

      <CalendarSyncCard shop={shop} />

      <SocialLinksCard socialByPlatform={socialByPlatform} />

      <NotificationsCard
        shop={shop}
        accountEmail={accountEmail}
        marketingOptIn={marketingOptIn}
      />

      <TrackingCard shop={shop} />

      <PublishCard shop={shop} />


      <Submit label={a.common.saveChanges} />
    </form>
  );
}
