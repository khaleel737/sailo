import type { Metadata } from "next";
import Link from "next/link";
import { Download, Lock } from "lucide-react";
import { requireShop } from "@/lib/session";
import { can, cheapestPlanWith } from "@sailo/core/plans";
import { ImportPanel } from "@/app/admin/settings/data/_components/import-panel";
import { MigratePanel } from "@/app/admin/settings/data/_components/migrate-panel";
import { Badge, Card } from "@sailo/design-system/web";
import { getAdminT } from "@/i18n/server";

export const metadata: Metadata = { title: "Import & export" };

const EXPORTS = [
  {
    type: "products",
    label: "Products",
    note: "Handle, title, description, price, category, tags, stock and image URLs.",
  },
  {
    type: "orders",
    label: "Orders",
    note: "Every order with its money breakdown, customer, address, delivery and tracking.",
  },
  {
    type: "clients",
    label: "Customers",
    note: "Names, contact details, addresses, order counts and lifetime spend.",
  },
];

const PRODUCT_COLUMNS = [
  { name: "Title", note: "Required. Everything else is optional." },
  { name: "Handle", note: "Matches an existing product to update it. Derived from the title if blank." },
  { name: "Body (HTML)", note: "Description. Also accepts Description." },
  { name: "Price / Compare At Price", note: "Plain numbers — 29.99, not $29.99." },
  { name: "Type", note: "physical, digital or service. Defaults to physical." },
  { name: "Category", note: "Created automatically if it doesn't exist yet." },
  { name: "Tags", note: "Comma or pipe separated." },
  {
    name: "Option1 Name / Option1 Value",
    note: "Sizes, colours and so on, up to three. Repeat the Handle on a row per combination.",
  },
  { name: "Variant Price / Variant SKU", note: "Per combination. A blank price uses the product's." },
  { name: "Variant Inventory Qty", note: "Units in stock. Any number here turns stock tracking on." },
  { name: "In Stock / Featured / Published", note: "TRUE or FALSE." },
  { name: "Image Src", note: "One or more https URLs separated by |." },
];

const CLIENT_COLUMNS = [
  { name: "Email or Phone", note: "At least one is required — it identifies the customer." },
  { name: "First Name / Last Name", note: "Or a single Name column." },
  { name: "Address1, Address2, City, Province, Zip, Country", note: "Optional address." },
  { name: "Note", note: "Your private note about them." },
  { name: "Tags", note: "Comma or semicolon separated. Added to any tags they already have." },
  {
    /*
     * Stated as a column so it is read where sellers read column names, and
     * repeated as a banner below. This is the fact most likely to surprise
     * somebody later — they import three hundred contacts, send a broadcast,
     * and forty people receive it — so it is said twice on purpose.
     */
    name: "Marketing consent",
    note: "Can't be imported. Imported contacts start with no consent, so email broadcasts won't reach them until they opt in themselves.",
  },
];

export default async function DataPage() {
  const { a } = await getAdminT();
  const { shop } = await requireShop("settings:read");
  const canExport = can(shop, "csvExport");
  const exportPlan = cheapestPlanWith("csvExport");

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{a.data.export}</h2>
            <p className="mt-1 text-sm text-ink-500">
              Download your data as CSV. Opens in Excel, Numbers or Google
              Sheets, and matches Shopify&rsquo;s column names.
            </p>
          </div>
          {!canExport ? (
            <Badge tone="amber">
              <Lock className="size-3" />
              {exportPlan?.name}
            </Badge>
          ) : null}
        </div>

        <div className="mt-4 divide-y divide-ink-100">
          {EXPORTS.map((item) => (
            <div
              key={item.type}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-ink-500">{item.note}</p>
              </div>
              {canExport ? (
                <a
                  href={`/api/export/${item.type}`}
                  className="inline-flex h-9 pointer-coarse:h-11 shrink-0 items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3 text-sm font-medium text-ink-900 transition hover:bg-ink-50"
                >
                  <Download className="size-4" />
                  {a.data.downloadCsv}
                </a>
              ) : (
                <span className="text-xs text-ink-400">
                  Available on {exportPlan?.name}
                </span>
              )}
            </div>
          ))}
        </div>

        {!canExport ? (
          <p className="mt-3 text-xs text-ink-500">
            <Link
              href="/admin/settings/billing"
              className="font-medium text-ink-900 underline underline-offset-2"
            >
              Upgrade to {exportPlan?.name}
            </Link>{" "}
            to export.
          </p>
        ) : null}
      </Card>

      <div>
        <h2 className="mb-1 text-sm font-semibold">{a.data.import}</h2>
        <p className="mb-3 text-sm text-ink-500">
          Bring products and customers in from a spreadsheet or another
          platform. You&rsquo;ll see a preview before anything is saved.
          Orders can&rsquo;t be imported — same as Shopify.
        </p>

        <div className="space-y-3">
          {/*
            Above the CSV panels, because it is the one somebody arriving from
            another platform is looking for — and because the CSV importer is
            what they fall back to when their tool is not on the list, not the
            other way round.
          */}
          <MigratePanel unlocked={can(shop, "catalogueImport")} />

          <ImportPanel
            type="products"
            title={a.data.importProducts}
            description={a.data.importProductsBody}
            columns={PRODUCT_COLUMNS}
          />
          <ImportPanel
            type="clients"
            title={a.data.importClients}
            description={a.data.importClientsBody}
            columns={CLIENT_COLUMNS}
          />
        </div>
      </div>
    </div>
  );
}
