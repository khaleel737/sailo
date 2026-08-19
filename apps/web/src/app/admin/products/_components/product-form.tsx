"use client";

import { startTransition, useActionState, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { saveProduct } from "@/lib/actions/products";
import { ImageUploader } from "./image-uploader";
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
import { isProductKind, type ProductKind } from "@sailo/core/variants";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { priceIn } from "@sailo/core/regional";
import { Toggle } from "./toggle";
import { KindTabs, KIND_PANEL_ID } from "./kind-tabs";
import { StockCard } from "./stock-card";
import { PricingCard } from "./pricing-card";
import { PhysicalSettingsCard } from "./physical-settings-card";
import { DigitalDeliveryCard } from "./digital-delivery-card";
import { ServiceSettingsCard } from "./service-settings-card";
import { EventSettingsCard } from "./event-settings-card";
import { MembershipSettingsCard } from "./membership-settings-card";
import { LeadSettingsCard } from "./lead-settings-card";
import type { ProductWithRelations } from "./product.types";
import { interpolate } from "@sailo/i18n";
import type { Category } from "@sailo/db/schema";

/**
 * Adding or editing a product.
 *
 * The shape of this form is one decision: what is being sold. It used to be a
 * `<select>` sitting fifth, between the price and the category, and the fields
 * it governed appeared a screen and a half further down — so a seller adding
 * an event met the date field only if they scrolled past Options, and plenty
 * did not. The kind is now the first thing on the page and everything it
 * governs is in a panel plainly beneath it.
 *
 * WHAT IS IN THE PANEL AND WHAT IS NOT
 *
 * The panel holds what differs by kind: the kind's own card, and the stock
 * card whose three controls mean a shelf, a room or a diary depending on
 * which tab is lit. Outside it are the four things every kind has — what it
 * is called, what it costs, what it is filed under, and whether anyone can
 * see it. Moving those inside would have meant five copies of the title field
 * and five chances for one of them to drift.
 *
 * Only the active panel is rendered, which is what makes the exclusivity real
 * rather than visual: an input that is in the DOM is in the `FormData`, so a
 * hidden event panel would post a start time on a physical product.
 */

function Submit({ isEdit, pending }: { isEdit: boolean; pending: boolean }) {
  const a = useAdminT();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {isEdit ? a.common.saveChanges : a.products.add}
    </Button>
  );
}

export function ProductForm({
  product,
  categories,
  currency,
  timeZone = "UTC",
  /** Whether the shop can take a card — a membership cannot be sold without one. */
  cardReady = false,
  pricingModes = false,
  pricingUpgradeTo = null,
  weightBands = false,
  regionalCurrencies = [],
}: {
  product?: ProductWithRelations;
  categories: Category[];
  currency: string;
  /** The shop's zone, so an event's clock is named rather than assumed. */
  timeZone?: string;
  cardReady?: boolean;
  /** Whether the plan includes PWYW and sell windows — spec 43. */
  pricingModes?: boolean;
  /** The cheapest plan that does, named in the upgrade line. */
  pricingUpgradeTo?: string | null;
  /** Whether the plan prices postage by weight — spec 51, for the hint only. */
  weightBands?: boolean;
  /**
   * The other currencies the shop quotes — spec 53.
   *
   * Empty for every shop that has ticked none, which renders no extra fields
   * at all. Already filtered by the plan at the page, because a downgraded
   * shop keeps its typed prices and stops being able to edit them.
   */
  regionalCurrencies?: string[];
}) {
  const a = useAdminT();
  const [state, action, pending] = useActionState(saveProduct, { ok: false });
  const isEdit = Boolean(product);

  // The form shows different sections per kind and per toggle, so these are
  // held in state rather than read back from the DOM.
  const [kind, setKind] = useState<ProductKind>(() =>
    isProductKind(product?.kind ?? "") ? (product?.kind as ProductKind) : "physical",
  );
  const [trackInventory, setTrackInventory] = useState(
    product?.trackInventory ?? false,
  );
  const [price, setPrice] = useState(
    product ? centsToAmount(product.priceCents, currency) : "",
  );
  const [bookingEnabled, setBookingEnabled] = useState(
    product?.bookingEnabled ?? false,
  );
  const [releaseOnPayment, setReleaseOnPayment] = useState(
    product?.releaseOnPayment ?? true,
  );

  /*
   * A membership is one thing at one price, sold one at a time — Stripe prices
   * the product and `resolveLines` forces the quantity to one — so it gets no
   * strike-through and no stock card. Both would be controls whose values the
   * checkout ignores.
   */
  const membership = kind === "membership";

  return (
    <form
      /*
       * Submitted by hand rather than through `action={action}`, and the
       * reason is a refusal.
       *
       * React resets an uncontrolled form once a form action completes — it
       * cannot know whether the action succeeded, so it resets either way.
       * On this form that meant a seller who was told "add the code buyers get
       * after paying" watched their title, description, tags and every other
       * typed field empty themselves at the same moment. The one refusal they
       * could act on cost them everything else they had written.
       *
       * Dispatching inside a transition ourselves keeps React out of the
       * submit, so the DOM is left exactly as the seller left it and the
       * message tells them the one thing to change. `required` still runs
       * first: the browser validates before it fires `submit` at all.
       */
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => action(data));
      }}
      className="space-y-5"
    >
      {product ? <input type="hidden" name="id" value={product.id} /> : null}

      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.ok && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : null}

      {/* ---- What is being sold ------------------------------------------ */}

      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">
            {a.productForm.kindTitle}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
            {a.productForm.kindBody}
          </p>
        </div>
        <KindTabs value={kind} onChange={setKind} />
      </Card>

      {/* ---- The four things every kind has ------------------------------- */}

      <Card className="space-y-4 p-5">
        <Field label={a.productForm.titleLabel} htmlFor="title">
          <Input
            id="title"
            name="title"
            required
            maxLength={140}
            defaultValue={product?.title}
            placeholder={a.productForm.titlePlaceholder}
          />
        </Field>

        <Field
          label={a.productForm.descriptionLabel}
          htmlFor="description"
          hint={a.common.optional}
        >
          <Textarea
            id="description"
            name="description"
            rows={4}
            defaultValue={product?.description ?? ""}
            placeholder={a.productForm.descriptionPlaceholder}
          />
        </Field>

        <Field label={a.productForm.photos}>
          <ImageUploader initial={product?.images.map((i) => i.url) ?? []} />
        </Field>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={interpolate(
              membership ? a.productForm.priceEach : a.productForm.price,
              { currency },
            )}
            htmlFor="price"
          >
            <Input
              id="price"
              name="price"
              inputMode="decimal"
              required
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="24.00"
            />
          </Field>

          {membership ? null : (
            <Field
              label={a.productForm.compareAt}
              htmlFor="compareAtPrice"
              hint={a.common.optional}
            >
              <Input
                id="compareAtPrice"
                name="compareAtPrice"
                inputMode="decimal"
                defaultValue={
                  product?.compareAtCents
                    ? centsToAmount(product.compareAtCents, currency)
                    : ""
                }
                placeholder="32.00"
              />
            </Field>
          )}
        </div>

        {/*
          The same price again, in each currency the shop quotes — spec 53.

          One pair of fields per currency, right under the shop's own price
          rather than in a section of their own, because they are the same
          decision made a second time: what this product costs. A seller who
          has to go and find a "regional pricing" tab will price half a
          catalogue and leave the rest, and half a catalogue is exactly the
          state that keeps a currency from ever going live.

          Blank is not zero. A blank field means "no price in this currency",
          which keeps the currency off the storefront until it is filled in;
          `0` means free. `moneyToCents` keeps that distinction and
          `buildCurrencyPrices` drops the currency rather than storing a zero.
        */}
        {regionalCurrencies.map((code) => (
          <div key={code} className="grid gap-4 sm:grid-cols-2">
            <Field
              label={interpolate(a.productForm.price, { currency: code })}
              htmlFor={`price_${code}`}
              hint={a.common.optional}
            >
              <Input
                id={`price_${code}`}
                name={`price_${code}`}
                inputMode="decimal"
                defaultValue={
                  product ? centsToAmount(priceIn(product, code)?.price ?? null, code) : ""
                }
              />
            </Field>

            {membership ? null : (
              <Field
                label={interpolate(a.productForm.compareAtIn, { currency: code })}
                htmlFor={`compareAtPrice_${code}`}
                hint={a.common.optional}
              >
                <Input
                  id={`compareAtPrice_${code}`}
                  name={`compareAtPrice_${code}`}
                  inputMode="decimal"
                  defaultValue={
                    product
                      ? centsToAmount(priceIn(product, code)?.secondary ?? null, code)
                      : ""
                  }
                />
              </Field>
            )}
          </div>
        ))}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={a.productForm.category}
            htmlFor="categoryId"
            hint={a.common.optional}
          >
            <Select
              id="categoryId"
              name="categoryId"
              defaultValue={product?.categoryId ?? ""}
            >
              <option value="">{a.productForm.noCategory}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={a.productForm.tags}
            htmlFor="tags"
            hint={a.productForm.tagsHint}
          >
            <Input
              id="tags"
              name="tags"
              defaultValue={product?.tags.join(", ") ?? ""}
              placeholder={a.productForm.tagsPlaceholder}
            />
          </Field>
        </div>
      </Card>

      {/*
        How the price is arrived at, and when it is on sale — spec 43.

        Outside the kind panel and directly under the price it modifies: a
        launch window is as meaningful on a run of mugs as on a download, and a
        donation is a digital product with a floor of zero rather than a kind of
        its own. A membership is the one refusal — a recurring buyer-chosen
        amount is a Stripe Price per buyer — so it is not offered one.
      */}
      {membership ? null : (
        <PricingCard
          product={product}
          currency={currency}
          timeZone={timeZone}
          allowed={pricingModes}
          upgradeTo={pricingUpgradeTo}
        />
      )}

      {/* ---- This kind's own settings ------------------------------------- */}

      <div
        id={KIND_PANEL_ID}
        role="tabpanel"
        aria-labelledby={`product-kind-tab-${kind}`}
        /*
         * Focusable, per the APG: the panel holds its own controls, so it is
         * not a `tabindex="0"` container — the tab order goes straight from
         * the tablist into the first field inside it.
         */
        className="space-y-5"
      >
        {kind === "physical" ? (
          <PhysicalSettingsCard product={product} weightBands={weightBands} />
        ) : null}

        {kind === "digital" ? (
          <DigitalDeliveryCard
            product={product}
            releaseOnPayment={releaseOnPayment}
            onReleaseOnPaymentChange={setReleaseOnPayment}
          />
        ) : null}

        {kind === "service" ? (
          <ServiceSettingsCard
            product={product}
            bookingEnabled={bookingEnabled}
            onBookingEnabledChange={setBookingEnabled}
          />
        ) : null}

        {kind === "event" ? (
          <EventSettingsCard
            product={product}
            releaseOnPayment={releaseOnPayment}
            onReleaseOnPaymentChange={setReleaseOnPayment}
            timeZone={timeZone}
          />
        ) : null}

        {kind === "membership" ? (
          <MembershipSettingsCard
            product={product}
            currency={currency}
            connected={cardReady}
          />
        ) : null}

        {kind === "lead" ? <LeadSettingsCard product={product} /> : null}

        {/*
          A form has no stock and no price. `membership` was already excluded
          for the same reason — a thing that renews is not a thing there are
          five of — and a lead is the second: there is nothing to run out of,
          and a "sold out" enquiry form is a sentence with no meaning.
        */}
        {membership || kind === "lead" ? null : (
          <StockCard
            kind={kind}
            product={product}
            currency={currency}
            price={price}
            /* Spec 33's preorder date is wall-clock in the shop's own zone,
               like spec 43's two window fields. */
            timeZone={timeZone}
            trackInventory={trackInventory}
            onTrackInventoryChange={setTrackInventory}
            regionalCurrencies={regionalCurrencies}
          />
        )}
      </div>

      {/* ---- Visibility --------------------------------------------------- */}

      <Card className="space-y-3 p-5">
        <Toggle
          name="inStock"
          label={a.productForm.inStock}
          description={a.productForm.inStockBody}
          defaultChecked={product?.inStock ?? true}
        />
        <Toggle
          name="isFeatured"
          label={a.productForm.featured}
          description={a.productForm.featuredBody}
          defaultChecked={product?.isFeatured ?? false}
        />
        <Toggle
          name="isPublished"
          label={a.productForm.published}
          description={a.productForm.publishedBody}
          defaultChecked={product?.isPublished ?? true}
        />
      </Card>

      <div className="flex items-center gap-3">
        <Submit isEdit={isEdit} pending={pending} />
        <Link
          href="/admin/products"
          className="focus-ring inline-flex items-center rounded text-sm text-ink-500 transition hover:text-ink-900 pointer-coarse:min-h-11"
        >
          {a.common.cancel}
        </Link>
      </div>
    </form>
  );
}
