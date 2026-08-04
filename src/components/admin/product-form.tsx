"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { saveProduct } from "@/lib/actions/products";
import { ImageUploader } from "./image-uploader";
import { FileUploader } from "./file-uploader";
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
import { PRODUCT_KINDS } from "@/lib/utils";
import type {
  Category,
  Product,
  ProductFile,
  ProductImage,
  ProductVariant,
} from "@/db/schema";

type ProductWithRelations = Product & {
  images: ProductImage[];
  variants: ProductVariant[];
  files: ProductFile[];
};

function Submit({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {isEdit ? "Save changes" : "Add product"}
    </Button>
  );
}

export function ProductForm({
  product,
  categories,
  currency,
}: {
  product?: ProductWithRelations;
  categories: Category[];
  currency: string;
}) {
  const [state, action] = useActionState(saveProduct, { ok: false });
  const isEdit = Boolean(product);

  // The form shows different sections per kind and per toggle, so these three
  // are held in state rather than read back from the DOM.
  const [kind, setKind] = useState(product?.kind ?? "physical");
  const [trackInventory, setTrackInventory] = useState(
    product?.trackInventory ?? false,
  );
  const [price, setPrice] = useState(
    product ? (product.priceCents / 100).toFixed(2) : "",
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
        <Field label="Title" htmlFor="title">
          <Input
            id="title"
            name="title"
            required
            maxLength={140}
            defaultValue={product?.title}
            placeholder="Speckled stoneware mug"
          />
        </Field>

        <Field label="Description" htmlFor="description" hint="optional">
          <Textarea
            id="description"
            name="description"
            rows={4}
            defaultValue={product?.description ?? ""}
            placeholder="Wheel-thrown, glazed in matte oatmeal. Holds 350ml. Dishwasher safe."
          />
        </Field>

        <Field label="Photos">
          <ImageUploader initial={product?.images.map((i) => i.url) ?? []} />
        </Field>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Price (${currency})`} htmlFor="price">
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
            label="Compare-at price"
            htmlFor="compareAtPrice"
            hint="optional"
          >
            <Input
              id="compareAtPrice"
              name="compareAtPrice"
              inputMode="decimal"
              defaultValue={
                product?.compareAtCents
                  ? (product.compareAtCents / 100).toFixed(2)
                  : ""
              }
              placeholder="32.00"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="kind">
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

          <Field label="Category" htmlFor="categoryId" hint="optional">
            <Select
              id="categoryId"
              name="categoryId"
              defaultValue={product?.categoryId ?? ""}
            >
              <option value="">No category</option>
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
            ? "Digital products skip delivery and are sent as a private download link."
            : kind === "service"
              ? "Services skip delivery. Add a duration and let buyers pick a time below."
              : "Physical products ask the buyer how they'd like it delivered."}
        </p>

        <Field
          label="Tags"
          htmlFor="tags"
          hint="comma separated, used by search"
        >
          <Input
            id="tags"
            name="tags"
            defaultValue={product?.tags.join(", ") ?? ""}
            placeholder="handmade, ceramic, gift"
          />
        </Field>
      </Card>

      {/* ---- Options and variants ---------------------------------------- */}

      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">Options & stock</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Sizes, colours, session lengths — anything the buyer chooses between.
          </p>
        </div>

        <Toggle
          name="trackInventory"
          label="Track stock"
          description="Counts units down with every order and stops sales at zero."
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
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-sm font-semibold text-ink-900">
              Files to deliver
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Buyers get a private download page as soon as the order is
              released.
            </p>
          </div>

          <FileUploader
            initial={
              product?.files.map((f) => ({
                name: f.name,
                url: f.url,
                sizeBytes: f.sizeBytes,
                contentType: f.contentType,
              })) ?? []
            }
          />

          <Toggle
            name="releaseOnPayment"
            label="Release only after payment is confirmed"
            description="Every payment option here settles outside Sailo, so leaving this on stops someone taking the file without paying. Free products unlock straight away either way."
            checked={releaseOnPayment}
            onChange={setReleaseOnPayment}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Download limit"
              htmlFor="downloadLimit"
              hint="blank = unlimited"
            >
              <Input
                id="downloadLimit"
                name="downloadLimit"
                inputMode="numeric"
                defaultValue={product?.downloadLimit ?? ""}
                placeholder="5"
              />
            </Field>
            <Field
              label="Link expires after (days)"
              htmlFor="downloadExpiryDays"
              hint="blank = never"
            >
              <Input
                id="downloadExpiryDays"
                name="downloadExpiryDays"
                inputMode="numeric"
                defaultValue={product?.downloadExpiryDays ?? ""}
                placeholder="30"
              />
            </Field>
          </div>
        </Card>
      ) : null}

      {/* ---- Service settings -------------------------------------------- */}

      {kind === "service" ? (
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-sm font-semibold text-ink-900">
              Service details
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">
              How long it takes, where it happens, and whether buyers book a
              time.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Duration (minutes)"
              htmlFor="durationMinutes"
              hint="optional"
            >
              <Input
                id="durationMinutes"
                name="durationMinutes"
                inputMode="numeric"
                defaultValue={product?.durationMinutes ?? ""}
                placeholder="60"
              />
            </Field>
            <Field label="Where" htmlFor="serviceMode">
              <Select
                id="serviceMode"
                name="serviceMode"
                defaultValue={product?.serviceMode ?? "in_person"}
              >
                <option value="in_person">In person</option>
                <option value="online">Online</option>
              </Select>
            </Field>
          </div>

          <Field
            label="Location or joining details"
            htmlFor="serviceLocation"
            hint="optional, shown after ordering"
          >
            <Textarea
              id="serviceLocation"
              name="serviceLocation"
              rows={2}
              defaultValue={product?.serviceLocation ?? ""}
              placeholder="12 Rue Lafayette, Paris — studio on the second floor"
            />
          </Field>

          <Toggle
            name="bookingEnabled"
            label="Let buyers pick a date and time"
            description="Adds a preferred date and time to checkout. You confirm the slot afterwards."
            checked={bookingEnabled}
            onChange={setBookingEnabled}
          />

          {bookingEnabled ? (
            <Field
              label="Notice needed (hours)"
              htmlFor="bookingLeadHours"
              hint="the picker won't offer anything sooner"
            >
              <Input
                id="bookingLeadHours"
                name="bookingLeadHours"
                inputMode="numeric"
                defaultValue={product?.bookingLeadHours ?? 24}
                placeholder="24"
                className="sm:w-40"
              />
            </Field>
          ) : null}
        </Card>
      ) : null}

      {/* ---- Visibility --------------------------------------------------- */}

      <Card className="space-y-3 p-5">
        <Toggle
          name="inStock"
          label="In stock"
          description="Turn off to show a Sold out badge and disable ordering."
          defaultChecked={product?.inStock ?? true}
        />
        <Toggle
          name="isFeatured"
          label="Featured"
          description="Pins this product to the top of your shop."
          defaultChecked={product?.isFeatured ?? false}
        />
        <Toggle
          name="isPublished"
          label="Published"
          description="Uncheck to hide it from your shop while you work on it."
          defaultChecked={product?.isPublished ?? true}
        />
      </Card>

      <div className="flex items-center gap-3">
        <Submit isEdit={isEdit} />
        <Link
          href="/admin/products"
          className="text-sm text-ink-500 transition hover:text-ink-900"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Toggle({
  name,
  label,
  description,
  defaultChecked,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  description: string;
  defaultChecked?: boolean;
  /** Pass both to drive the toggle from the form's own state. */
  checked?: boolean;
  onChange?: (next: boolean) => void;
}) {
  const controlled = checked !== undefined && onChange !== undefined;

  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        name={name}
        {...(controlled
          ? { checked, onChange: (e) => onChange(e.target.checked) }
          : { defaultChecked })}
        className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900"
      />
      <span>
        <span className="block text-sm font-medium text-ink-900">{label}</span>
        <span className="block text-xs text-ink-500">{description}</span>
      </span>
    </label>
  );
}
