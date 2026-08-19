"use client";

import { useState } from "react";
import {
  FileDown,
  KeyRound,
  Link2,
  ListOrdered,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Card, Field, Input, Textarea } from "@sailo/design-system/web";
import { ChoiceGroup } from "./choice-group";
import {
  DIGITAL_DELIVERY_VALUES,
  isDigitalDelivery,
  type DigitalDelivery,
} from "@sailo/core/variants";
import { Toggle } from "./toggle";
import { FileUploader } from "./file-uploader";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import type { ProductWithRelations } from "./product.types";

/**
 * What a digital product delivers, and when the buyer gets it.
 *
 * It delivered files and only files, which is one of the three things sellers
 * mean by "digital": the course hosted on somebody else's platform, the
 * Discord invite, the licence key were all being sold as downloads that did
 * not exist. The product saved, published, took money and handed over nothing.
 *
 * ONE SHAPE, NOT THREE
 *
 * The picker is exclusive for the buyer's sake rather than the form's. A
 * download page showing a file, a link *and* a code makes the buyer work out
 * which of them is the thing they paid for; a seller who filled in all three
 * has almost certainly meant one. `saveProduct` clears the two that are not
 * chosen, so switching a product from a link to a file leaves no live URL
 * behind that the download page would still be entitled to render.
 *
 * The release switch is shared by all three because the promise is the same
 * one made three ways: nothing is handed over until the money is confirmed.
 */

const ICONS: Record<DigitalDelivery, LucideIcon> = {
  file: FileDown,
  link: Link2,
  code: KeyRound,
};

export function DigitalDeliveryCard({
  product,
  releaseOnPayment,
  onReleaseOnPaymentChange,
  codePools = false,
  licensing = false,
}: {
  product?: ProductWithRelations;
  releaseOnPayment: boolean;
  onReleaseOnPaymentChange: (next: boolean) => void;
  /** Whether the plan hands each buyer their own code — spec 48. */
  codePools?: boolean;
  /** Whether the plan issues checkable licence keys — spec 48. */
  licensing?: boolean;
}) {
  const a = useAdminT();
  const [delivery, setDelivery] = useState<DigitalDelivery>(() =>
    isDigitalDelivery(product?.digitalDelivery) ? product.digitalDelivery : "file",
  );
  /*
   * `""` is the shared string and it is the default, so a shop that never
   * opens this control keeps handing out one code to everybody — the `0034`
   * rule applied to a form field rather than a column.
   */
  const [codeSource, setCodeSource] = useState<string>(
    () => product?.codeSource ?? "",
  );
  const [licenseEnabled, setLicenseEnabled] = useState(
    () => product?.licenseEnabled ?? false,
  );

  const labels: Record<DigitalDelivery, string> = {
    file: a.productForm.deliverFile,
    link: a.productForm.deliverLink,
    code: a.productForm.deliverCode,
  };
  const blurbs: Record<DigitalDelivery, string> = {
    file: a.productForm.deliverFileBody,
    link: a.productForm.deliverLinkBody,
    code: a.productForm.deliverCodeBody,
  };

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">
          {a.productForm.digitalTitle}
        </h2>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
          {a.productForm.digitalBody}
        </p>
      </div>

      {/*
        A radiogroup rather than a second tablist. The kind above is the page's
        subject and owns the tab semantics; this is one field inside that
        page's panel, and nesting tablists would tell a screen reader there are
        two sets of pages here when there is one.
      */}
      <input type="hidden" name="digitalDelivery" value={delivery} />
      <ChoiceGroup
        variant="tile"
        ariaLabel={a.productForm.deliveryMethod}
        value={delivery}
        onChange={setDelivery}
        options={DIGITAL_DELIVERY_VALUES.map((option) => ({
          value: option,
          label: labels[option],
          description: blurbs[option],
          icon: ICONS[option],
        }))}
      />

      {/*
        Only the chosen shape's fields are rendered — not hidden, not disabled.
        An input that is in the DOM is in the `FormData`, so a link left
        mounted behind a file would be posted alongside it and the two would
        have to be untangled on the server for no reason.
      */}
      {delivery === "file" ? (
        <div className="space-y-3">
          <div>
            <h3 className="text-[13px] font-medium text-ink-800">
              {a.productForm.filesTitle}
            </h3>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
              {a.productForm.filesBody}
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
        </div>
      ) : null}

      {delivery === "link" ? (
        <Field
          label={a.productForm.digitalLink}
          htmlFor="digitalLinkUrl"
          help={a.productForm.digitalLinkHint}
        >
          <Input
            id="digitalLinkUrl"
            name="digitalLinkUrl"
            type="url"
            inputMode="url"
            maxLength={2000}
            defaultValue={product?.digitalLinkUrl ?? ""}
            placeholder="https://school.teachable.com/p/ceramics"
          />
        </Field>
      ) : null}

      {/*
        Where a code comes from — spec 48.

        Offered under `link` as well as `code`, because a one-seat invite URL
        is a code that happens to be a URL and has exactly the same scarcity
        problem: one string handed to two hundred buyers is the product given
        away. `file` has no pool — the bytes are the good.

        Rendered only when the plan allows it. A shop without `codePools` sees
        the shared field it has always seen rather than a control that would
        refuse them on save, and `saveProduct` falls back to null for the same
        reason: downgrading a shop must not make its products unsavable.
      */}
      {codePools && (delivery === "code" || delivery === "link") ? (
        <div className="space-y-3">
          <input type="hidden" name="codeSource" value={codeSource} />
          <ChoiceGroup
            variant="tile"
            ariaLabel={a.productForm.codeSourceLabel}
            value={codeSource}
            onChange={setCodeSource}
            options={[
              {
                value: "",
                label: a.productForm.codeSourceShared,
                description: a.productForm.codeSourceSharedBody,
                icon: KeyRound,
              },
              {
                value: "pool",
                label: a.productForm.codeSourcePool,
                description: a.productForm.codeSourcePoolBody,
                icon: ListOrdered,
              },
              {
                value: "generated",
                label: a.productForm.codeSourceGenerated,
                description: a.productForm.codeSourceGeneratedBody,
                icon: Sparkles,
              },
            ]}
          />

          {codeSource === "generated" ? (
            <Field
              label={a.productForm.codePattern}
              htmlFor="codePattern"
              help={a.productForm.codePatternHint}
            >
              <Input
                id="codePattern"
                name="codePattern"
                maxLength={64}
                defaultValue={product?.codePattern ?? "SAILO-XXXX-XXXX-XXXX"}
                placeholder="SAILO-XXXX-XXXX-XXXX"
              />
            </Field>
          ) : null}

          {codeSource === "pool" ? (
            <p className="text-xs leading-relaxed text-ink-500">
              {a.productForm.poolRefundNote}
            </p>
          ) : null}
        </div>
      ) : null}

      {/*
        The shared string, and only where it is still the thing being handed
        over. A pooled product has no single code to type, so demanding one
        would be a required field with no correct answer — `saveProduct` waives
        the refusal for exactly this case.
      */}
      {delivery === "code" && codeSource === "" ? (
        <Field
          label={a.productForm.digitalCode}
          htmlFor="digitalAccessDetails"
          help={a.productForm.digitalCodeHint}
        >
          <Textarea
            id="digitalAccessDetails"
            name="digitalAccessDetails"
            rows={3}
            maxLength={2000}
            defaultValue={product?.digitalAccessDetails ?? ""}
            placeholder={a.productForm.digitalCodePlaceholder}
          />
        </Field>
      ) : null}

      {/*
        Licence keys — spec 48. Offered on every delivery shape, because the
        software being licensed is usually a file the buyer also downloads.
      */}
      {licensing ? (
        <div className="space-y-3 border-t border-black/5 pt-4">
          <div>
            <h3 className="text-[13px] font-medium text-ink-800">
              {a.productForm.licenseTitle}
            </h3>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
              {a.productForm.licenseBody}
            </p>
          </div>
          <Toggle
            name="licenseEnabled"
            label={a.productForm.licenseEnabled}
            description={a.productForm.licenseDocs}
            checked={licenseEnabled}
            onChange={setLicenseEnabled}
          />
          {licenseEnabled ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={a.productForm.licenseActivationLimit}
                htmlFor="licenseActivationLimit"
                hint={a.productForm.licenseActivationLimitHint}
              >
                <Input
                  id="licenseActivationLimit"
                  name="licenseActivationLimit"
                  inputMode="numeric"
                  defaultValue={product?.licenseActivationLimit ?? ""}
                  placeholder="3"
                />
              </Field>
              <Field
                label={a.productForm.licenseDays}
                htmlFor="licenseDays"
                hint={a.productForm.licenseDaysHint}
              >
                <Input
                  id="licenseDays"
                  name="licenseDays"
                  inputMode="numeric"
                  defaultValue={product?.licenseDays ?? ""}
                  placeholder="365"
                />
              </Field>
            </div>
          ) : null}
        </div>
      ) : null}

      <Toggle
        name="releaseOnPayment"
        label={a.productForm.releaseOnPayment}
        description={a.productForm.releaseOnPaymentBody}
        checked={releaseOnPayment}
        onChange={onReleaseOnPaymentChange}
      />

      {/*
        The two download terms belong to files alone. A link is a link — we do
        not proxy it, so there is nothing to count and nothing to expire — and
        a code is a string the buyer already has. Offering either against them
        would be a setting that quietly does nothing.
      */}
      {delivery === "file" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={a.productForm.downloadLimit}
            htmlFor="downloadLimit"
            hint={a.productForm.downloadLimitHint}
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
            label={a.productForm.downloadExpiry}
            htmlFor="downloadExpiryDays"
            hint={a.productForm.downloadExpiryHint}
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
      ) : null}
    </Card>
  );
}
