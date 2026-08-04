"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { createShop } from "@/lib/actions/shop";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { HandleField } from "@/components/admin/handle-field";
import { CURRENCIES, slugify } from "@/lib/utils";
import { normalizeHandle } from "@/lib/handle";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      Create my shop
    </Button>
  );
}

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const [state, action] = useActionState(createShop, { ok: false });

  return (
    <form action={action} className="space-y-4">
      {state.error ? <Alert>{state.error}</Alert> : null}

      <HandleField defaultValue={normalizeHandle(slugify(defaultName))} autoFocus />

      <Field label="Shop name" htmlFor="name">
        <Input
          id="name"
          name="name"
          required
          defaultValue={defaultName}
          placeholder="Amina's Ceramics"
        />
      </Field>

      <Field label="Short description" htmlFor="description" hint="optional">
        <Textarea
          id="description"
          name="description"
          rows={2}
          maxLength={280}
          placeholder="Handmade stoneware, fired in small batches in Lagos."
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Currency" htmlFor="currency">
          <Select id="currency" name="currency" defaultValue="USD">
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="WhatsApp" htmlFor="whatsapp" hint="optional">
          <Input
            id="whatsapp"
            name="whatsapp"
            inputMode="tel"
            placeholder="234801234567"
          />
        </Field>
      </div>

      <p className="text-xs text-ink-400">
        Include your country code, no + or spaces. This is where orders land.
      </p>

      <Submit />
    </form>
  );
}
