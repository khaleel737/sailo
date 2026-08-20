"use client";

import { useActionState } from "react";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { createFlow, type FlowState } from "@/lib/actions/flows";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
} from "@sailo/design-system/web";

type Option = { id: string; label: string };

const TRIGGERS = [
  "list.joined",
  "product.purchased",
  "waitlist.signup",
  "contact.updated",
] as const;

/**
 * Name + trigger, nothing else. The steps live in the editor this redirects
 * to — a seller deciding what starts a sequence and a seller writing its
 * emails are in two different frames of mind, and the second one deserves a
 * saved draft under it.
 *
 * Controlled inputs throughout: a React 19 form resets after a refused
 * action, and losing a typed name to a validation message is the bug.
 */
export function NewFlowForm({
  lists,
  products,
}: {
  lists: Option[];
  products: Option[];
}) {
  const a = useAdminT();
  const [state, act, busy] = useActionState<FlowState, FormData>(createFlow, {
    ok: true,
  });

  return (
    <form action={act}>
      <Card className="max-w-xl space-y-4 p-5">
        {state.error ? <Alert tone="error">{a.flows.problems}</Alert> : null}

        <Field label={a.flows.nameLabel}>
          <Input
            name="name"
            required
            maxLength={120}
            placeholder={a.flows.namePlaceholder}
          />
        </Field>

        <TriggerFields lists={lists} products={products} />

        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            {a.flows.create}
          </Button>
        </div>
      </Card>
    </form>
  );
}

/**
 * The trigger and its one config field, swapped by selection. Uncontrolled
 * `<select>`s are safe here — a refusal can only be a missing name, and the
 * selects always hold a valid value.
 */
export function TriggerFields({
  lists,
  products,
  defaultType,
  defaultListId,
  defaultProductId,
}: {
  lists: Option[];
  products: Option[];
  defaultType?: string;
  defaultListId?: string;
  defaultProductId?: string;
}) {
  const a = useAdminT();

  const labels: Record<(typeof TRIGGERS)[number], string> = {
    "list.joined": a.flows.triggerListJoined,
    "product.purchased": a.flows.triggerProductPurchased,
    "waitlist.signup": a.flows.triggerWaitlistSignup,
    "contact.updated": a.flows.triggerContactUpdated,
  };

  return (
    <>
      <Field label={a.flows.triggerLabel} hint={a.flows.triggerHint}>
        <Select name="trigger" defaultValue={defaultType ?? "list.joined"}>
          {TRIGGERS.map((value) => (
            <option key={value} value={value}>
              {labels[value]}
            </option>
          ))}
        </Select>
      </Field>

      {/* Both pickers always render; the server reads only the one the
          chosen trigger uses. An empty value means "any", which the enrol
          path treats as an absent config — not a sentinel. */}
      <Field label={labels["list.joined"]}>
        <Select name="listId" defaultValue={defaultListId ?? ""}>
          <option value="">{a.flows.anyList}</option>
          {lists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={labels["product.purchased"]}>
        <Select name="productId" defaultValue={defaultProductId ?? ""}>
          <option value="">{a.flows.anyProduct}</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.label}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}
