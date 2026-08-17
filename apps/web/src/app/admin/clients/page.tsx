import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { CLIENT_LIMIT, getShopClients } from "@/lib/queries";
import { normalizeTag, tagVocabulary } from "@sailo/core/tags";
import { PageHeader } from "@sailo/design-system/web";
import { ExportButton } from "@/app/admin/_components/export-button";
import { AddContact } from "./_components/add-contact";
import { Table, Td, Th, Tr } from "@sailo/design-system/web";
import { Badge, EmptyState } from "@sailo/design-system/web";
import { formatAddress } from "@sailo/core/address";
import { formatMoney } from "@sailo/core/currency";

export const metadata: Metadata = { title: "Clients" };

export default async function AdminClientsPage({
  searchParams,
}: PageProps<"/admin/clients">) {
  const { shop } = await requireShop();
  const { a, locale } = await getAdminT();

  /*
   * Normalised before it reaches the query, with the same function that
   * normalised it on the way in. A hand-typed `?tag=VIP` must find the same
   * people the tag editor's "VIP" saved, or the filter is a coin toss.
   */
  const params = await searchParams;
  const raw = Array.isArray(params.tag) ? params.tag[0] : params.tag;
  const tag = normalizeTag(raw ?? "");

  /*
   * Two reads, and the second is not a duplicate. The list is filtered; the
   * vocabulary has to come from the whole shop, or filtering to `vip` would
   * leave `vip` as the only tag anyone could then choose and there would be
   * no way back to the others.
   */
  const [clients, everyone] = await Promise.all([
    getShopClients(shop.id, CLIENT_LIMIT, tag),
    tag ? getShopClients(shop.id, CLIENT_LIMIT) : Promise.resolve(null),
  ]);
  const vocabulary = tagVocabulary(everyone ?? clients);

  // Same reasoning as the catalogue: at the ceiling the list is a sample, and
  // the copy has to say so rather than name a number that is not the truth.
  const clipped = clients.length >= CLIENT_LIMIT;

  return (
    <>
      <PageHeader
        title={a.clients.title}
        description={
          tag
            ? `${clients.length.toLocaleString(locale)}${clipped ? "+" : ""} tagged ${tag}.`
            : clients.length > 0
              ? `${clients.length.toLocaleString(locale)}${clipped ? "+" : ""} ${clients.length === 1 ? "person has" : "people have"} ordered from you.`
              : "Everyone who has ordered from you."
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <AddContact vocabulary={vocabulary} />
            <ExportButton shop={shop} type="clients" />
          </div>
        }
      />

      {vocabulary.length > 0 ? (
        <nav
          aria-label={a.clients.tags}
          className="mb-4 flex flex-wrap items-center gap-1.5"
        >
          <Link
            href="/admin/clients"
            aria-current={tag ? undefined : "page"}
            className={
              tag
                ? "focus-ring rounded-full px-2.5 py-1 text-xs font-medium text-ink-500 hover:bg-ink-100"
                : "focus-ring rounded-full bg-ink-900 px-2.5 py-1 text-xs font-medium text-white"
            }
          >
            {a.clients.allTags}
          </Link>
          {vocabulary.map((value) => (
            <Link
              key={value}
              href={`/admin/clients?tag=${encodeURIComponent(value)}`}
              aria-current={tag === value ? "page" : undefined}
              className={
                tag === value
                  ? "focus-ring rounded-full bg-ink-900 px-2.5 py-1 text-xs font-medium text-white"
                  : "focus-ring rounded-full px-2.5 py-1 text-xs font-medium text-ink-500 hover:bg-ink-100"
              }
            >
              {value}
            </Link>
          ))}
        </nav>
      ) : null}

      {clients.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6" />}
          title={tag ? a.clients.noneTagged : a.clients.empty}
          description={tag ? a.clients.noneTaggedBody : a.clients.emptyBody}
        />
      ) : (
        <Table
          minWidth="48rem"
          head={
            <>
              <Th>{a.columns.client}</Th>
              <Th>{a.clients.tags}</Th>
              <Th>{a.columns.where}</Th>
              <Th align="end">{a.columns.orders}</Th>
              <Th align="end">{a.columns.spent}</Th>
            </>
          }
        >
          {clients.map((client) => {
            const address = formatAddress(client);
            return (
              <Tr key={client.id}>
                <Td>
                  <Link
                    href={`/admin/clients/${client.id}`}
                    /* The row is the tap target for the whole client, and the
                       avatar sets its height at 36px — under the floor, and a
                       row is exactly where a near-miss opens the wrong person's
                       record. `min-h-11` on touch, with no change to the type
                       or the avatar, so the table keeps its density on a
                       mouse. */
                    className="focus-ring flex min-w-0 items-center gap-3 rounded pointer-coarse:min-h-11"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-600">
                      {client.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink-900">
                        {client.name}
                      </span>
                      <span className="block truncate text-xs text-ink-400">
                        {[client.email, client.phone]
                          .filter(Boolean)
                          .join(" · ") || "No contact details"}
                      </span>
                    </span>
                  </Link>
                </Td>

                <Td className="max-w-[14rem]" label={a.clients.tags}>
                  {client.tags.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {client.tags.map((value) => (
                        <Badge key={value}>{value}</Badge>
                      ))}
                    </span>
                  ) : (
                    <span className="text-ink-300">—</span>
                  )}
                </Td>

                <Td className="max-w-xs" label={a.columns.where}>
                  {address ? (
                    <span className="block truncate text-xs text-ink-500">
                      {address}
                    </span>
                  ) : (
                    <span className="text-ink-300">—</span>
                  )}
                </Td>

                <Td align="end" className="tabular" label={a.columns.orders}>
                  {client.orderCount}
                </Td>

                <Td align="end" className="tabular font-medium text-ink-900" label={a.columns.spent}>
                  {formatMoney(client.totalCents, shop.currency, locale)}
                </Td>
              </Tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
