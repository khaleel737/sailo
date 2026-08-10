import type { Metadata } from "next";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { PageHeader } from "@/components/shared/page-header";
import { CheckinForm } from "./_components/checkin-form";

export const metadata: Metadata = { title: "Check-in" };

/**
 * The door, on the seller's phone. A buyer's ticket QR encodes this page's
 * URL with the code prefilled, so any camera app lands here — behind the
 * seller's own session — and one tap admits.
 */
export default async function AdminCheckinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireShop();
  const { a } = await getAdminT();
  const params = await searchParams;
  const code = typeof params.code === "string" ? params.code : "";

  return (
    <>
      <PageHeader title={a.checkin.title} description={a.checkin.description} />
      <CheckinForm initialCode={code} />
    </>
  );
}
