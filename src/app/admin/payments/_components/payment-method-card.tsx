"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Banknote, Mail, Phone, Wallet } from "lucide-react";
import { PLATFORM_ICONS } from "@/app/[handle]/_components/social-icons";
import { savePaymentMethod } from "@/lib/actions/payments";
import { isConfigured, type PaymentMethodDef } from "@/lib/payments";
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
import type { PaymentConfig, PaymentMethod } from "@/db/schema";

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

const ICONS: Record<string, (p: { className?: string }) => React.ReactNode> = {
  whatsapp: PLATFORM_ICONS.whatsapp!,
  telegram: PLATFORM_ICONS.telegram!,
  instagram: PLATFORM_ICONS.instagram!,
  email: Mail,
  phone: Phone,
  bank_transfer: Banknote,
  cod: Wallet,
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      Save
    </Button>
  );
}

export function PaymentMethodCard({
  def,
  method,
}: {
  def: PaymentMethodDef;
  method?: PaymentMethod;
}) {
  const [state, action] = useActionState(savePaymentMethod, { ok: false });
  const config = (method?.config ?? {}) as PaymentConfig;
  const configured = method ? isConfigured(def.type, config) : false;
  const live = Boolean(method?.isEnabled) && configured;

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
        live ? (
          <Badge tone="green" dot>
            Live
          </Badge>
        ) : configured ? (
          <Badge tone="amber" dot>
            Off
          </Badge>
        ) : (
          <Badge tone="neutral" dot>
            Not set up
          </Badge>
        )
      }
    >
      <form action={action} className="space-y-4">
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
            hint={field.required ? undefined : "optional"}
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
          label="Button text"
          htmlFor={`${def.type}-label`}
          hint={`defaults to "${def.name}"`}
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
            label="Show on my shop"
            description={
              configured || !method
                ? undefined
                : "Fill in the details above before turning this on."
            }
          />
          <Submit />
        </div>
      </form>
    </Panel>
  );
}
