"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
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
} from "@/components/ui";
import { PRODUCT_KINDS } from "@/lib/utils";
import type { Category, Product, ProductImage } from "@/db/schema";

type ProductWithImages = Product & { images: ProductImage[] };

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
  product?: ProductWithImages;
  categories: Category[];
  currency: string;
}) {
  const [state, action] = useActionState(saveProduct, { ok: false });
  const isEdit = Boolean(product);

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
              defaultValue={
                product ? (product.priceCents / 100).toFixed(2) : ""
              }
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
              defaultValue={product?.kind ?? "physical"}
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
}: {
  name: string;
  label: string;
  description: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900"
      />
      <span>
        <span className="block text-sm font-medium text-ink-900">{label}</span>
        <span className="block text-xs text-ink-500">{description}</span>
      </span>
    </label>
  );
}
