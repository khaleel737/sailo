"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { ChevronRight, Loader2 } from "lucide-react";
import { savePaymentMethod } from "@/lib/actions/payments";
import { isConfigured, type PaymentMethodDef } from "@/lib/payments";
import { Alert, Badge, Button, Card, Field, Input, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { PaymentConfig, PaymentMethod } from "@/db/schema";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
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
            <Badge tone={def.kind === "manual" ? "blue" : "neutral"}>
              {def.kind === "manual" ? "Manual payment" : "Chat handoff"}
            </Badge>
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

          {def.fields.map((field) =>
            field.multiline ? (
              <Field
                key={field.key}
                label={field.label}
                htmlFor={`${def.type}-${field.key}`}
                hint={field.required ? undefined : "optional"}
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
                hint={field.required ? field.hint : (field.hint ?? "optional")}
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
              <span className="text-sm font-medium">Show on my shop</span>
            </label>
            <Submit />
          </div>
        </form>
      ) : null}
    </Card>
  );
}
