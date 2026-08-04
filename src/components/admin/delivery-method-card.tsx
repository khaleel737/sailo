"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { ChevronRight, Loader2 } from "lucide-react";
import { saveDeliveryMethod } from "@/lib/actions/delivery";
import { isDeliveryConfigured, type DeliveryMethodDef } from "@/lib/delivery";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Textarea,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import type { DeliveryConfig, DeliveryMethod } from "@/db/schema";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      Save
    </Button>
  );
}

export function DeliveryMethodCard({
  def,
  method,
  currency,
}: {
  def: DeliveryMethodDef;
  method?: DeliveryMethod;
  currency: string;
}) {
  const [state, action] = useActionState(saveDeliveryMethod, { ok: false });
  const config = (method?.config ?? {}) as DeliveryConfig;
  const configured = method ? isDeliveryConfigured(def.type, config) : false;
  const live = Boolean(method?.isEnabled) && configured;
  const [open, setOpen] = useState(!method);

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-ink-50"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{def.name}</span>
            {live ? (
              <Badge tone="green">Live</Badge>
            ) : configured ? (
              <Badge tone="amber">Off</Badge>
            ) : (
              <Badge>Not set up</Badge>
            )}
            {method && method.feeCents > 0 ? (
              <Badge tone="blue">
                {(method.feeCents / 100).toFixed(2)} {currency}
              </Badge>
            ) : method ? (
              <Badge tone="green">Free</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">
            {def.description}
          </p>
        </div>
        <ChevronRight
          className={cn(
            "size-4 shrink-0 text-ink-400 transition",
            open && "rotate-90",
          )}
        />
      </button>

      {open ? (
        <form action={action} className="space-y-4 border-t border-ink-100 p-4">
          <input type="hidden" name="type" value={def.type} />

          {state.error ? <Alert>{state.error}</Alert> : null}
          {state.ok && state.message ? (
            <Alert tone="success">{state.message}</Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Fee (${currency})`} htmlFor={`${def.type}-fee`}>
              <Input
                id={`${def.type}-fee`}
                name="fee"
                inputMode="decimal"
                defaultValue={
                  method ? (method.feeCents / 100).toFixed(2) : "0.00"
                }
              />
            </Field>
            <Field
              label="Free over"
              htmlFor={`${def.type}-freeOver`}
              hint="optional"
            >
              <Input
                id={`${def.type}-freeOver`}
                name="freeOver"
                inputMode="decimal"
                defaultValue={
                  method?.freeOverCents !== null &&
                  method?.freeOverCents !== undefined
                    ? (method.freeOverCents / 100).toFixed(2)
                    : ""
                }
                placeholder="50.00"
              />
            </Field>
          </div>

          {def.fields.map((field) =>
            field.multiline ? (
              <Field
                key={field.key}
                label={field.label}
                htmlFor={`${def.type}-${field.key}`}
              >
                <Textarea
                  id={`${def.type}-${field.key}`}
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
                htmlFor={`${def.type}-${field.key}`}
              >
                <Input
                  id={`${def.type}-${field.key}`}
                  name={field.key}
                  defaultValue={config[field.key] ?? ""}
                  placeholder={field.placeholder}
                />
              </Field>
            ),
          )}

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

          <div className="flex items-center justify-between gap-3 border-t border-ink-100 pt-4">
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                name="isEnabled"
                defaultChecked={method?.isEnabled ?? false}
                className="size-4 rounded border-ink-300 accent-ink-900"
              />
              <span className="text-sm font-medium">Offer at checkout</span>
            </label>
            <Submit />
          </div>
        </form>
      ) : null}
    </Card>
  );
}
