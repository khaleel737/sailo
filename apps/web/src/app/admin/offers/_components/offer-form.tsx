"use client";

import { startTransition, useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { saveOffer } from "@/lib/actions/offers-admin";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
  Textarea,
} from "@sailo/design-system/web";
import { centsToAmount } from "@sailo/core/currency";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { interpolate } from "@sailo/i18n";
import { localMoment } from "@/app/admin/products/_lib/local-moment";
import type { Offer } from "@sailo/db/schema";

/**
 * Adding or editing one offer — specs 08 and 36.
 *
 * One form for both placements, because they are one table and one decision:
 * a seller attaching a companion product picks *where* it appears rather than
 * which feature they are using. Two editors would be two mental models for one
 * row, and the fields are identical.
 *
 * The copy under the placement picker is the part that earns its place. "In the
 * cart" and "after they pay" are not interchangeable and the difference is not
 * obvious from the outside — Baymard's 66% is why the second one exists, and a
 * seller choosing between them deserves the reason rather than the label.
 */
export function OfferForm({
  offer,
  products,
  currency,
  timeZone,
}: {
  offer?: Offer;
  /** The shop's own published products — both ends of the offer come from here. */
  products: { id: string; title: string }[];
  currency: string;
  timeZone: string;
}) {
  const a = useAdminT();
  const [state, action, pending] = useActionState(saveOffer, { ok: false });
  const [placement, setPlacement] = useState(offer?.placement ?? "bump");

  return (
    <Card className="space-y-4 p-5">
      <form
        /*
         * Dispatched by hand, for the reason the product form's own note gives:
         * React resets an uncontrolled form once an action completes, whether or
         * not it succeeded — so a seller told "that product isn't in your shop"
         * would watch everything else they typed empty itself at the same
         * moment.
         */
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          startTransition(() => action(data));
        }}
        className="space-y-4"
      >
        {offer ? <input type="hidden" name="id" value={offer.id} /> : null}

        {state.error ? <Alert>{state.error}</Alert> : null}
        {state.ok && state.message ? (
          <Alert tone="success">{state.message}</Alert>
        ) : null}

        <Field
          label={a.products.offerPlacement}
          htmlFor="placement"
          help={
            placement === "bump" ? a.products.offerBumpHint : a.products.offerCrossSellHint
          }
        >
          <Select
            id="placement"
            name="placement"
            value={placement}
            onChange={(e) => setPlacement(e.target.value)}
          >
            <option value="bump">{a.products.offerPlacementBump}</option>
            <option value="crosssell">{a.products.offerPlacementCrossSell}</option>
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={a.products.offerSourceProduct}
            htmlFor="sourceProductId"
            hint={a.common.optional}
            help={a.products.offerSourceProductHint}
          >
            <Select
              id="sourceProductId"
              name="sourceProductId"
              defaultValue={offer?.sourceProductId ?? ""}
            >
              {/* Blank is "every product in this shop", which is what a seller
                  with one thing to cross-sell actually wants — and saves them
                  attaching the same offer to forty products by hand. */}
              <option value="">{a.products.offerAnyProduct}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={a.products.offerProduct} htmlFor="offerProductId">
            <Select
              id="offerProductId"
              name="offerProductId"
              required
              defaultValue={offer?.offerProductId ?? ""}
            >
              <option value="">{a.products.offerPickProduct}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={a.products.offerHeadline}
            htmlFor="title"
            hint={a.common.optional}
            help={a.products.offerHeadlineHint}
          >
            <Input
              id="title"
              name="title"
              maxLength={120}
              defaultValue={offer?.title ?? ""}
            />
          </Field>
          <Field
            label={interpolate(a.products.offerPrice, { currency })}
            htmlFor="priceCents"
            hint={a.common.optional}
            help={a.products.offerPriceHint}
          >
            <Input
              id="priceCents"
              name="priceCents"
              inputMode="decimal"
              defaultValue={
                offer?.priceCents !== null && offer?.priceCents !== undefined
                  ? centsToAmount(offer.priceCents, currency)
                  : ""
              }
            />
          </Field>
        </div>

        <Field label={a.products.offerBody} htmlFor="body" hint={a.common.optional}>
          <Textarea id="body" name="body" rows={2} defaultValue={offer?.body ?? ""} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={a.products.offerButtonLabel}
            htmlFor="buttonLabel"
            hint={a.common.optional}
          >
            <Input
              id="buttonLabel"
              name="buttonLabel"
              maxLength={40}
              defaultValue={offer?.buttonLabel ?? ""}
            />
          </Field>
          <Field label={a.products.offerDisplay} htmlFor="display">
            <Select id="display" name="display" defaultValue={offer?.display ?? "card"}>
              <option value="card">{a.products.offerDisplayCard}</option>
              <option value="compact">{a.products.offerDisplayCompact}</option>
              <option value="timer">{a.products.offerDisplayTimer}</option>
            </Select>
          </Field>
        </div>

        {/*
          The window, and the one thing a seller has to be told about it: it is
          checked again when the buyer presses the button, not only when the
          page drew it. Theirs is explicit about that and it is right — a page
          can sit open for an hour.
        */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={a.products.offerValidFrom}
            htmlFor="validFrom"
            hint={a.common.optional}
            help={interpolate(a.products.offerWindowHint, { zone: timeZone })}
          >
            <Input
              id="validFrom"
              name="validFrom"
              type="datetime-local"
              defaultValue={localMoment(offer?.validFrom ?? null, timeZone)}
            />
          </Field>
          <Field label={a.products.offerValidUntil} htmlFor="validUntil" hint={a.common.optional}>
            <Input
              id="validUntil"
              name="validUntil"
              type="datetime-local"
              defaultValue={localMoment(offer?.validUntil ?? null, timeZone)}
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={offer?.isActive ?? true}
            className="size-4 rounded border-ink-300"
          />
          {a.products.offerActive}
        </label>

        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {offer ? a.common.saveChanges : a.products.offerAdd}
        </Button>
      </form>
    </Card>
  );
}
