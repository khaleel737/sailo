"use client";

import { startTransition, useActionState, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Select,
  Textarea,
} from "@sailo/design-system/web";
import type { Collection, CollectionItem } from "@sailo/db/schema";
import { PREVIEW_REFUSAL } from "@sailo/core/content";
import {
  deleteCollectionItem,
  saveCollection,
  saveCollectionItem,
} from "@/lib/actions/collections";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * Build a collection: a title, how it unlocks, and an ordered list of items.
 *
 * Every form submits by hand rather than through `action={action}`, for the
 * reason `product-form.tsx` documents: React resets an uncontrolled form once a
 * form action completes, so a refusal — and the most likely refusal here is
 * "a preview may not be a file" — would empty the item the seller had just
 * written along with the message telling them what to change.
 */
export function CollectionEditor({
  productId,
  productKind,
  collection,
  items,
  files,
  dripAllowed,
}: {
  productId: string;
  productKind: string;
  collection: Collection | null;
  items: CollectionItem[];
  files: { id: string; name: string }[];
  dripAllowed: boolean;
}) {
  const a = useAdminT();
  const [saveState, save, saving] = useActionState(saveCollection, { ok: false });
  const [drip, setDrip] = useState(collection?.dripMode ?? "none");

  if (productKind !== "digital" && productKind !== "membership") {
    return <Alert tone="info">{a.content.wrongKind}</Alert>;
  }

  return (
    <div className="space-y-5">
      {saveState.error ? <Alert>{saveState.error}</Alert> : null}
      {saveState.ok && saveState.message ? (
        <Alert tone="success">{saveState.message}</Alert>
      ) : null}

      <Card className="space-y-4 p-5">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            startTransition(() => save(data));
          }}
          className="space-y-4"
        >
          <input type="hidden" name="productId" value={productId} />

          <Field label={a.content.collectionTitle} htmlFor="collection-title">
            <Input
              id="collection-title"
              name="title"
              defaultValue={collection?.title ?? ""}
              maxLength={160}
              required
            />
          </Field>

          <Field
            label={a.content.description}
            htmlFor="collection-description"
            hint={a.content.descriptionHint}
          >
            <Textarea
              id="collection-description"
              name="description"
              rows={2}
              defaultValue={collection?.description ?? ""}
            />
          </Field>

          <Field
            label={a.content.dripMode}
            htmlFor="drip-mode"
            hint={dripAllowed ? a.content.dripHint : a.content.dripLocked}
          >
            <Select
              id="drip-mode"
              name="dripMode"
              value={drip}
              onChange={(event) => setDrip(event.target.value)}
            >
              <option value="none">{a.content.dripNone}</option>
              <option value="interval">{a.content.dripInterval}</option>
            </Select>
          </Field>

          {drip === "interval" ? (
            <Field
              label={a.content.dripDays}
              htmlFor="drip-days"
              hint={a.content.dripDaysHint}
            >
              <Input
                id="drip-days"
                name="dripIntervalDays"
                type="number"
                min={0}
                max={365}
                defaultValue={collection?.dripIntervalDays ?? 7}
              />
            </Field>
          ) : null}

          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {collection ? a.common.save : a.content.create}
          </Button>
        </form>
      </Card>

      {collection ? (
        <>
          {items.map((item) => (
            <ItemCard
              key={item.id}
              collectionId={collection.id}
              item={item}
              files={files}
            />
          ))}
          <ItemCard collectionId={collection.id} item={null} files={files} />
        </>
      ) : null}
    </div>
  );
}

function ItemCard({
  collectionId,
  item,
  files,
}: {
  collectionId: string;
  item: CollectionItem | null;
  files: { id: string; name: string }[];
}) {
  const a = useAdminT();
  const [state, save, saving] = useActionState(saveCollectionItem, { ok: false });
  const [removeState, remove, removing] = useActionState(deleteCollectionItem, {
    ok: false,
  });
  const [preview, setPreview] = useState(item?.isPreview ?? false);
  const [fileId, setFileId] = useState(item?.fileId ?? "");

  /*
   * Shown before the seller submits, because the server refuses the same
   * combination and being told after typing a lesson is the worse order. The
   * server check is still the control — this is only earlier.
   */
  const previewConflict = preview && fileId !== "";

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-ink-900">
          {item ? item.title : a.content.addItem}
        </h2>
        {item?.isPreview ? <Badge tone="green">{a.content.previewBadge}</Badge> : null}
      </div>

      {state.error ? <Alert>{state.error}</Alert> : null}
      {removeState.error ? <Alert>{removeState.error}</Alert> : null}
      {state.ok && state.message ? <Alert tone="success">{state.message}</Alert> : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          startTransition(() => save(data));
        }}
        className="space-y-4"
      >
        <input type="hidden" name="collectionId" value={collectionId} />
        {item ? <input type="hidden" name="id" value={item.id} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={a.content.itemTitle} htmlFor={`title-${item?.id ?? "new"}`}>
            <Input
              id={`title-${item?.id ?? "new"}`}
              name="title"
              defaultValue={item?.title ?? ""}
              maxLength={200}
              required
            />
          </Field>

          <Field
            label={a.content.section}
            htmlFor={`section-${item?.id ?? "new"}`}
            hint={a.content.sectionHint}
          >
            <Input
              id={`section-${item?.id ?? "new"}`}
              name="section"
              defaultValue={item?.section ?? ""}
              maxLength={80}
            />
          </Field>

          <Field label={a.content.position} htmlFor={`position-${item?.id ?? "new"}`}>
            <Input
              id={`position-${item?.id ?? "new"}`}
              name="position"
              type="number"
              defaultValue={item?.position ?? 0}
            />
          </Field>

          <Field
            label={a.content.unlockOverride}
            htmlFor={`after-${item?.id ?? "new"}`}
            hint={a.content.unlockOverrideHint}
          >
            <Input
              id={`after-${item?.id ?? "new"}`}
              name="availableAfterDays"
              type="number"
              min={0}
              max={365}
              defaultValue={item?.availableAfterDays ?? ""}
            />
          </Field>
        </div>

        <Field label={a.content.file} htmlFor={`file-${item?.id ?? "new"}`}>
          <Select
            id={`file-${item?.id ?? "new"}`}
            name="fileId"
            value={fileId}
            onChange={(event) => setFileId(event.target.value)}
          >
            <option value="">{a.content.noFile}</option>
            {files.map((file) => (
              <option key={file.id} value={file.id}>
                {file.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={a.content.embed}
          htmlFor={`embed-${item?.id ?? "new"}`}
          hint={a.content.embedHint}
        >
          <Input
            id={`embed-${item?.id ?? "new"}`}
            name="externalUrl"
            type="url"
            inputMode="url"
            defaultValue={item?.externalUrl ?? ""}
            placeholder="https://www.youtube.com/watch?v=…"
          />
        </Field>

        <Field
          label={a.content.body}
          htmlFor={`body-${item?.id ?? "new"}`}
          hint={a.content.bodyHint}
        >
          <Textarea
            id={`body-${item?.id ?? "new"}`}
            name="bodyMd"
            rows={4}
            defaultValue={item?.bodyMd ?? ""}
          />
        </Field>

        <label className="flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
          <input
            type="checkbox"
            name="isPreview"
            checked={preview}
            onChange={(event) => setPreview(event.target.checked)}
            className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
          />
          <span>
            <span className="block text-sm font-medium">{a.content.preview}</span>
            <span className="block text-xs text-ink-500">{a.content.previewHint}</span>
          </span>
        </label>

        {previewConflict ? <Alert tone="warning">{PREVIEW_REFUSAL}</Alert> : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={saving || previewConflict}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {item ? a.common.save : a.content.addItem}
          </Button>
        </div>
      </form>

      {item ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            startTransition(() => remove(data));
          }}
          className="border-t border-ink-100 pt-3"
        >
          <input type="hidden" name="collectionId" value={collectionId} />
          <input type="hidden" name="id" value={item.id} />
          <Button type="submit" variant="ghost" size="sm" disabled={removing}>
            <Trash2 className="size-4" />
            {a.common.delete}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
