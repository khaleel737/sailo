"use client";

import { Card, Switch } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import type { Shop } from "@sailo/db/schema";

export function PublishCard({ shop }: { shop: Shop }) {
  const a = useAdminT();

  return (
          <Card className="p-5">
            <Switch
              name="isPublished"
              defaultChecked={shop.isPublished}
              label={a.settings.shopIsLive}
              description={a.settings.shopIsLiveBody}
            />
          </Card>
  );
}
