"use client";

import { HandleField } from "@/components/shared/handle-field";
import { ImageUploader } from "@/app/admin/products/_components/image-uploader";
import { Card, Field, Input, Textarea } from "@sailo/design-system/web";
import type { Dictionary } from "@sailo/i18n";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import type { Shop } from "@sailo/db/schema";

export function IdentityCard({ shop, t }: { shop: Shop; t: Dictionary }) {
  const a = useAdminT();

  return (
          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold text-ink-900">{a.settings.identity}</h2>

            <HandleField
              label={t.handle.label}
              prefix="sailo.store/"
              defaultValue={shop.handle}
              currentHandle={shop.handle}
              t={t}
            />

            <Field label={a.settings.shopName} htmlFor="name">
              <Input id="name" name="name" required defaultValue={shop.name} />
            </Field>

            <Field
              label={a.settings.shopDescription}
              htmlFor="description"
              hint={a.common.optional}
            >
              <Textarea
                id="description"
                name="description"
                rows={3}
                maxLength={280}
                defaultValue={shop.description ?? ""}
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={a.settings.profilePicture} hint={a.settings.profilePictureHint}>
                <ImageUploader
                  name="avatarUrl"
                  initial={shop.avatarUrl ? [shop.avatarUrl] : []}
                  max={1}
                />
              </Field>

              <Field label={a.settings.logo} hint={a.settings.logoHint}>
                <ImageUploader
                  name="logoUrl"
                  initial={shop.logoUrl ? [shop.logoUrl] : []}
                  max={1}
                  aspect="wide"
                />
              </Field>
            </div>
          </Card>
  );
}
