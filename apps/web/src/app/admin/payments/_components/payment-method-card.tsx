"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Banknote, Mail, Phone, Wallet } from "lucide-react";
import { PLATFORM_ICONS } from "@/app/[handle]/_components/social-icons";
import { savePaymentMethod } from "@/lib/actions/payments";
import { isConfigured, isRailAvailable, type PaymentMethodDef } from "@/lib/payments";
import {
  Alert,
  Badge,
  Button,
  Field,
  Input,
  Switch,
  Textarea,
} from "@/components/ui";
import { Panel } from "@/components/overlays";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { interpolate } from "@/i18n";
import type { PaymentConfig, PaymentMethod } from "@sailo/db/schema";

/*
 * One rail, one panel. The summary row has to answer "can a buyer use this
 * right now?" without being opened, because that is the only question this
 * page exists to answer — everything below the fold is configuration.
 *
 * Three states, and they are genuinely different problems:
 *
 *   Live        it works, and it is on the shop.
 *   Off         filled in but switched off — one toggle away from working.
 *   Not set up  it needs details before it can do anything at all.
 */

/*
 * Spread rather than picked one by one: PLATFORM_ICONS already holds these
 * three under the same keys, and naming each was three assertions saying the
 * map has what the map defines.
 */
const ICONS: Record<string, (p: { className?: string }) => React.ReactNode> = {
  ...PLATFORM_ICONS,
  email: Mail,
  phone: Phone,
  bank_transfer: Banknote,
  cod: Wallet,
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {label}
    </Button>
  );
}

export function PaymentMethodCard({
  def,
  method,
  currency,
}: {
  def: PaymentMethodDef;
  method?: PaymentMethod;
  /** The shop's currency — some rails can only settle a few. */
  currency: string;
}) {
  const a = useAdminT();
  const [state, action] = useActionState(savePaymentMethod, { ok: false });
  const config = (method?.config ?? {}) as PaymentConfig;
  const configured = method ? isConfigured(def.type, config) : false;
  /*
   * A rail that cannot settle this shop's currency is shown and explained
   * rather than hidden. Hiding it answers "why can't I take PayPal?" with
   * silence; naming the currency answers it, and tells a seller who *could*
   * switch currency that switching is the lever.
   */
  const available = isRailAvailable(def.type, currency);
  const live = Boolean(method?.isEnabled) && configured && available;

  const Icon = ICONS[def.type] ?? Wallet;

  return (
    <Panel
      tone={live ? "active" : "default"}
      icon={<Icon className="size-5" />}
      title={def.name}
      subtitle={def.description}
      // A rail nobody has touched opens itself: there is nothing to summarise
      // yet and the next thing to do is fill it in.
      defaultOpen={!method}
      status={
        !available ? (
          <Badge tone="neutral" dot>
            {a.payments.unavailableHere}
          </Badge>
        ) : live ? (
          <Badge tone="green" dot>
            {a.common.live}
          </Badge>
        ) : configured ? (
          <Badge tone="amber" dot>
            {a.common.off}
          </Badge>
        ) : (
          <Badge tone="neutral" dot>
            {a.payments.notSetUp}
          </Badge>
        )
      }
    >
      {available ? null : (
        <Alert>
          {interpolate(a.payments.currencyOnly, {
            method: def.name,
            currencies: (def.availability?.currencies ?? []).join(", "),
            currency,
          })}
        </Alert>
      )}

      <form action={action} className="space-y-4" hidden={!available}>
        <input type="hidden" name="type" value={def.type} />

        {state.error ? <Alert>{state.error}</Alert> : null}
        {state.ok && state.message ? (
          <Alert tone="success">{state.message}</Alert>
        ) : null}

        {def.fields.map((field) => (
          <Field
            key={field.key}
            label={field.label}
            htmlFor={`${def.type}-${field.key}`}
            hint={field.required ? undefined : a.common.optional}
            help={field.hint}
          >
            {field.multiline ? (
              <Textarea
                id={`${def.type}-${field.key}`}
                name={field.key}
                rows={2}
                defaultValue={config[field.key] ?? ""}
                placeholder={field.placeholder}
              />
            ) : (
              <Input
                id={`${def.type}-${field.key}`}
                name={field.key}
                defaultValue={config[field.key] ?? ""}
                placeholder={field.placeholder}
              />
            )}
          </Field>
        ))}

        <Field
          label={a.payments.buttonText}
          htmlFor={`${def.type}-label`}
          hint={interpolate(a.payments.buttonTextHint, { name: def.name })}
        >
          <Input
            id={`${def.type}-label`}
            name="label"
            defaultValue={method?.label ?? ""}
            placeholder={def.name}
            maxLength={60}
          />
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-200 pt-4">
          <Switch
            name="isEnabled"
            defaultChecked={method?.isEnabled ?? false}
            label={a.payments.showOnShop}
            description={
              configured || !method ? undefined : a.payments.fillInFirst
            }
          />
          <Submit label={a.common.save} />
        </div>
      </form>
    </Panel>
  );
}
