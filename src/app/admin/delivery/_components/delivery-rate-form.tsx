"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Plus } from "lucide-react";
import { saveDeliveryMethod } from "@/lib/actions/delivery";
import { centsToAmount } from "@/lib/utils";
import {
  DELIVERY_METHOD_DEFS,
  DELIVERY_METHOD_LIST,
  type DeliveryMethodType,
} from "@/lib/delivery";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import type { DeliveryConfig, DeliveryMethod } from "@/db/schema";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

function Submit({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : isEdit ? null : (
        <Plus className="size-4" />
      )}
      {isEdit ? "Save option" : "Add option"}
    </Button>
  );
}

export function DeliveryRateForm({
  method,
  currency,
}: {
  method?: DeliveryMethod;
  currency: string;
}) {
  const a = useAdminT();
  const [state, action] = useActionState(saveDeliveryMethod, { ok: false });
  const [type, setType] = useState<DeliveryMethodType>(
    (method?.type as DeliveryMethodType) ?? "shipping",
  );
  const formRef = useRef<HTMLFormElement>(null);
  const config = (method?.config ?? {}) as DeliveryConfig;

  useEffect(() => {
    if (state.ok && !method) formRef.current?.reset();
  }, [state, method]);

  const def = DELIVERY_METHOD_DEFS[type];

  return (
    <Card className="p-5">
      <form ref={formRef} action={action} className="space-y-4">
        {method ? <input type="hidden" name="id" value={method.id} /> : null}

        {state.error ? <Alert>{state.error}</Alert> : null}
        {state.ok && state.message ? (
          <Alert tone="success">{state.message}</Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={a.delivery.kind} htmlFor={`${method?.id ?? "new"}-type`}>
            <Select
              id={`${method?.id ?? "new"}-type`}
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value as DeliveryMethodType)}
            >
              {DELIVERY_METHOD_LIST.map((d) => (
                <option key={d.type} value={d.type}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={a.delivery.nameBuyersSee}
            htmlFor={`${method?.id ?? "new"}-name`}
          >
            <Input
              id={`${method?.id ?? "new"}-name`}
              name="name"
              required
              maxLength={60}
              defaultValue={method?.name ?? ""}
              placeholder={
                type === "shipping" ? "Standard delivery" : "Studio pickup"
              }
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Fee (${currency})`} htmlFor={`${method?.id ?? "new"}-fee`}>
            <Input
              id={`${method?.id ?? "new"}-fee`}
              name="fee"
              inputMode="decimal"
              defaultValue={centsToAmount(method?.feeCents ?? 0, currency)}
            />
          </Field>
          <Field
            label={a.delivery.freeOverLabel}
            htmlFor={`${method?.id ?? "new"}-freeOver`}
            hint={a.common.optional}
          >
            <Input
              id={`${method?.id ?? "new"}-freeOver`}
              name="freeOver"
              inputMode="decimal"
              defaultValue={
                method?.freeOverCents !== null &&
                method?.freeOverCents !== undefined
                  ? centsToAmount(method.freeOverCents, currency)
                  : ""
              }
              placeholder="75.00"
            />
          </Field>
        </div>

        {def.fields.map((field) =>
          field.multiline ? (
            <Field
              key={field.key}
              label={field.label}
              htmlFor={`${method?.id ?? "new"}-${field.key}`}
            >
              <Textarea
                id={`${method?.id ?? "new"}-${field.key}`}
                name={field.key}
                rows={2}
                defaultValue={config[field.key] ?? ""}
                placeholder={field.placeholder}
              />
            </Field>
          ) : (
            <Field
              key={field.key}
              label={field.label}
              htmlFor={`${method?.id ?? "new"}-${field.key}`}
            >
              <Input
                id={`${method?.id ?? "new"}-${field.key}`}
                name={field.key}
                defaultValue={config[field.key] ?? ""}
                placeholder={field.placeholder}
              />
            </Field>
          ),
        )}

        <div className="flex items-center justify-between gap-3 border-t border-ink-100 pt-4">
          <label className="flex cursor-pointer items-center gap-2.5 pointer-coarse:min-h-11">
            <input
              type="checkbox"
              name="isEnabled"
              defaultChecked={method?.isEnabled ?? true}
              className="size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
            />
            <span className="text-sm font-medium">{a.delivery.offerAtCheckout}</span>
          </label>
          <Submit isEdit={Boolean(method)} />
        </div>
      </form>
    </Card>
  );
}
