import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { getShopEvent } from "@sailo/commerce/ticketing";
import { doorUrl, listDoorPasses } from "@/lib/door-pass";
import { appUrl } from "@/lib/app-url";
import { PageHeader } from "@sailo/design-system/web";
import { PassList } from "./_components/pass-list";

export const metadata: Metadata = {
  title: "Door passes",
  // A page that mints bearer credentials has no business in an index.
  robots: { index: false, follow: false },
};

export default async function DoorPassesPage({
  params,
}: PageProps<"/admin/checkin/[productId]/passes">) {
  const { shop } = await requireShop();
  const { a } = await getAdminT();
  const { productId } = await params;

  const event = await getShopEvent(shop.id, productId);
  if (!event) notFound();

  const base = appUrl();
  const passes = await listDoorPasses(shop.id, productId);

  return (
    <>
      <PageHeader
        title={a.checkin.passes}
        description={a.checkin.passesBody}
        back={{ href: `/admin/checkin/${productId}`, label: event.title }}
      />

      <div className="max-w-2xl">
        <PassList
          productId={productId}
          passes={passes.map((pass) => ({
            id: pass.id,
            name: pass.name,
            url: doorUrl(pass.token, base),
            scopedToEvent: pass.productId !== null,
            // Serialised, because a Date crossing to a client component is
            // fine but comparing it there against the server's clock is not.
            expiresAt: pass.expiresAt?.toISOString() ?? null,
            revokedAt: pass.revokedAt?.toISOString() ?? null,
            checkInCount: pass.checkInCount,
          }))}
        />
      </div>
    </>
  );
}
