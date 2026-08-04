"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { createShop } from "@/lib/actions/shop";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { CURRENCIES, normalizeHandle, slugify } from "@/lib/utils";

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
  const [handle, setHandle] = useState(() => normalizeHandle(slugify(defaultName)));

  return (
    <form action={action} className="space-y-4">
      {state.error ? <Alert>{state.error}</Alert> : null}

      <Field label="Your Shopik link" htmlFor="handle">
        <div className="flex items-center rounded-xl border border-ink-200 bg-white transition focus-within:border-ink-900 focus-within:ring-2 focus-within:ring-ink-900/10">
          <span className="pl-3 text-sm text-ink-400">shopik.to/</span>
          <input
            id="handle"
            name="handle"
            required
            minLength={3}
            maxLength={32}
            value={handle}
            onChange={(e) => setHandle(normalizeHandle(e.target.value))}
            className="h-10 flex-1 rounded-r-xl bg-transparent pl-0.5 pr-3 text-sm font-medium text-ink-900 focus:outline-none"
            placeholder="yourshop"
          />
        </div>
      </Field>

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
