"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { createShop } from "@/lib/actions/shop";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { HandleField } from "@/components/admin/handle-field";
import { CURRENCIES, slugify } from "@/lib/utils";
import { normalizeHandle } from "@/lib/handle";
import type { Dictionary } from "@/i18n";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

export function OnboardingForm({
  defaultName,
  t,
}: {
  defaultName: string;
  t: Dictionary;
}) {
  const [state, action] = useActionState(createShop, { ok: false });

  return (
    <form action={action} className="space-y-4">
      {state.error ? <Alert>{state.error}</Alert> : null}

      <HandleField
        defaultValue={normalizeHandle(slugify(defaultName))}
        autoFocus
        t={t}
      />

      <Field label={t.onboarding.shopName} htmlFor="name">
        <Input
          id="name"
          name="name"
          required
          defaultValue={defaultName}
          placeholder="Amina's Ceramics"
        />
      </Field>

      <Field
        label={t.onboarding.shortDescription}
        htmlFor="description"
        hint={t.common.optional}
      >
        <Textarea
          id="description"
          name="description"
          rows={2}
          maxLength={280}
          placeholder="Handmade stoneware, fired in small batches in Lagos."
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t.onboarding.currency} htmlFor="currency">
          <Select id="currency" name="currency" defaultValue="USD">
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={t.onboarding.whatsapp}
          htmlFor="whatsapp"
          hint={t.common.optional}
        >
          <Input
            id="whatsapp"
            name="whatsapp"
            inputMode="tel"
            placeholder="234801234567"
          />
        </Field>
      </div>

      <p className="text-xs text-ink-400">
        {t.onboarding.whatsappHint}
      </p>

      <Submit label={t.onboarding.createMyShop} />
    </form>
  );
}
