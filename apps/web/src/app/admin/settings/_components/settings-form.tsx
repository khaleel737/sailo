"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { updateShop } from "@/lib/actions/shop";
import { Alert, Button } from "@sailo/design-system/web";
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
import { BookingCard } from "./booking-card";
import { CalendarSyncCard } from "./calendar-sync-card";
import { CurrenciesCard } from "./currencies-card";
import { hoursOf } from "@sailo/commerce/booking";

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
  currencyGaps,
}: {
  shop: Shop;
  t: Dictionary;
  /**
   * What each ticked currency is still missing before it can be quoted —
   * spec 53. Empty for every shop that has ticked none, which is every shop
   * the day this ships.
   */
  currencyGaps: CurrencyGaps[];
}) {
  const a = useAdminT();
  const [state, action] = useActionState(updateShop, { ok: false });

  const socialByPlatform = new Map(shop.socials.map((s) => [s.platform, s.url]));

  return (
    <form action={action} className="space-y-5">
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.ok && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : null}

      <IdentityCard shop={shop} t={t} />

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

      <PublishCard shop={shop} />


      <Submit label={a.common.saveChanges} />
    </form>
  );
}
