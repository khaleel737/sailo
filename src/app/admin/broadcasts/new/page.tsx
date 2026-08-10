import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { can } from "@/lib/plans";
import { getShopClients } from "@/lib/queries";
import { tagVocabulary } from "@/lib/client-tags";
import { audienceSize } from "@/lib/broadcasts/audience";
import { PageHeader } from "@/components/shared/page-header";
import { Composer } from "../_components/composer";

export const metadata: Metadata = { title: "New broadcast" };

export default async function NewBroadcastPage() {
  const { shop } = await requireShop();
  const { a } = await getAdminT();
  // The gate is on the route, not only on the action: a locked feature whose
  // compose screen still opens is a feature that looks broken rather than
  // locked.
  if (!can(shop, "broadcasts")) notFound();

  const [clients, audienceCount] = await Promise.all([
    getShopClients(shop.id),
    audienceSize(shop.id, null),
  ]);

  return (
    <>
      <Link
        href="/admin/broadcasts"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 transition hover:text-ink-900"
      >
        <ArrowLeft className="size-4" />
        {a.broadcasts.title}
      </Link>

      <PageHeader
        title={a.broadcasts.compose}
        description={a.broadcasts.composeBody}
      />

      <Composer
        broadcast={null}
        tags={tagVocabulary(clients)}
        audienceCount={audienceCount}
      />
    </>
  );
}
