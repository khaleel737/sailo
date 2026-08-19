import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { listsFor } from "@sailo/marketing/contacts/server";
import { PageHeader } from "@sailo/design-system/web";
import { ListManager } from "./_components/list-manager";

export const metadata: Metadata = { title: "Lists" };

/*
 * Per-seller, behind a session, re-read on every visit. Declared here and not
 * only on the layout: a route reached by a client-side navigation does not
 * inherit the layout's declaration, which is what logged "uncached data during
 * a navigation" on the subscribers screen next door.
 */
export const instant = false;

/**
 * Lists — spec 34.
 *
 * A list is not a segment, and the two live apart on purpose. A segment is a
 * question re-asked at send time ("bought a mug, never since"); a list is a
 * set somebody was put in and can be seen to be in. Sellers want both and
 * confuse them constantly — a rule that quietly stopped matching looks exactly
 * like a member who was never added, which is why neither screen pretends to
 * be the other.
 *
 * Under `/admin/broadcasts` rather than in the sidebar. A list with nothing to
 * send to it is an address book, and the seller who needs one arrives here
 * from the campaign they were trying to narrow.
 */
export default async function ListsPage() {
  const { shop } = await requireShop();
  const { a } = await getAdminT();

  const lists = await listsFor(shop.id);

  return (
    <>
      <Link
        href="/admin/broadcasts"
        className="focus-ring mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 transition pointer-coarse:min-h-11 hover:text-ink-900"
      >
        <ArrowLeft className="size-4" />
        {a.broadcasts.title}
      </Link>

      <PageHeader
        title={a.broadcasts.listsTitle}
        description={a.broadcasts.listsDescription}
      />

      <ListManager lists={lists} />
    </>
  );
}
