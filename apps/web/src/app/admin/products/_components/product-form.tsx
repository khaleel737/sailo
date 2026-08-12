"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { saveProduct } from "@/lib/actions/products";
import { ImageUploader } from "./image-uploader";
import { VariantEditor } from "./variant-editor";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import { centsToAmount, PRODUCT_KINDS } from "@/lib/utils";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { Toggle } from "./toggle";
import { DigitalDeliveryCard } from "./digital-delivery-card";
import { ServiceSettingsCard } from "./service-settings-card";
import { EventSettingsCard } from "./event-settings-card";
import { MembershipSettingsCard } from "./membership-settings-card";
import type { ProductWithRelations } from "./product.types";
import { interpolate } from "@/i18n";
import type {
  Category,
} from "@sailo/db/schema";


function Submit({ isEdit }: { isEdit: boolean }) {
  const a = useAdminT();
  const { pending } = useFormStatus();
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
  /** Whether the shop can take a card — a membership cannot be sold without one. */
  cardReady = false,
}: {
  product?: ProductWithRelations;
  categories: Category[];
  currency: string;
  cardReady?: boolean;
}) {
  const a = useAdminT();
  const [state, action] = useActionState(saveProduct, { ok: false });
  const isEdit = Boolean(product);

  // The form shows different sections per kind and per toggle, so these three
  // are held in state rather than read back from the DOM.
  const [kind, setKind] = useState(product?.kind ?? "physical");
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

  return (
    <form action={action} className="space-y-5">
      {product ? <input type="hidden" name="id" value={product.id} /> : null}

      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.ok && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : null}

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
          <Field label={interpolate(a.productForm.price, { currency })} htmlFor="price">
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
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={a.productForm.kind} htmlFor="kind">
            <Select
              id="kind"
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {PRODUCT_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          </Field>

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
        </div>

        <p className="text-xs text-ink-500">
          {kind === "digital"
            ? a.productForm.digitalHint
            : kind === "service"
              ? a.productForm.serviceHint
              : kind === "event"
                ? a.productForm.eventHint
                : kind === "membership"
                  ? a.productForm.membershipHint
                  : a.productForm.physicalHint}
        </p>

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
      </Card>

      {/* ---- Options and variants ---------------------------------------- */}

      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">
            {a.productForm.optionsTitle}
          </h2>
          <p className="mt-0.5 text-xs text-ink-500">
            {a.productForm.optionsBody}
          </p>
        </div>

        <Toggle
          name="trackInventory"
          label={a.productForm.trackStock}
          description={a.productForm.trackStockBody}
          checked={trackInventory}
          onChange={setTrackInventory}
        />

        <VariantEditor
          options={product?.options ?? []}
          variants={product?.variants ?? []}
          currency={currency}
          basePrice={price}
          trackInventory={trackInventory}
          stockQuantity={product?.stockQuantity ?? null}
        />
      </Card>

      {/* ---- Digital delivery -------------------------------------------- */}

      {kind === "digital" ? (
        <DigitalDeliveryCard
          product={product}
          releaseOnPayment={releaseOnPayment}
          onReleaseOnPaymentChange={setReleaseOnPayment}
        />
      ) : null}

      {/* ---- Service settings -------------------------------------------- */}

      {kind === "service" ? (
        <ServiceSettingsCard
          product={product}
          bookingEnabled={bookingEnabled}
          onBookingEnabledChange={setBookingEnabled}
        />
      ) : null}

      {/* ---- Membership settings ------------------------------------------ */}

      {kind === "membership" ? (
        <MembershipSettingsCard
          product={product}
          currency={currency}
          connected={cardReady}
        />
      ) : null}

      {/* ---- Event settings ----------------------------------------------- */}

      {kind === "event" ? (
        <EventSettingsCard
          product={product}
          releaseOnPayment={releaseOnPayment}
          onReleaseOnPaymentChange={setReleaseOnPayment}
        />
      ) : null}

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
        <Submit isEdit={isEdit} />
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
