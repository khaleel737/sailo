import { LearnMore } from "@/app/admin/_components/learn-more";
import { docsUrl } from "@sailo/core/origin";
import type { Metadata } from "next";
import { interpolate } from "@sailo/i18n";
import Image from "next/image";
import Link from "next/link";
import { Eye, EyeOff, ImageIcon, Plus, Trash2, Upload } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { ADMIN_PRODUCT_LIMIT, getAdminProducts } from "@/lib/queries";
import { deleteProduct, toggleProductPublished } from "@/lib/actions/products";
import { PageHeader, TagsArt } from "@sailo/design-system/web";
import { ExportButton } from "@/app/admin/_components/export-button";
import { Table, Td, Th, Tr } from "@sailo/design-system/web";
import { Alert, Badge, Button, EmptyState } from "@sailo/design-system/web";
import { formatMoney } from "@sailo/core/currency";
import { anySellable, priceRange, unitsLeft } from "@sailo/core/variants";

export const metadata: Metadata = { title: "Products" };

/**
 * A table rather than a stack of cards.
 *
 * A catalogue is read by comparing rows — this price against that one, what is
 * hidden, what has run out — and a card stack puts every value in a different
 * horizontal position so none of them line up. Columns do the comparing for
 * you, which is why every commerce admin worth using ends up here.
 */
export default async function AdminProductsPage({
  searchParams,
}: PageProps<"/admin/products">) {
  const { shop } = await requireShop("products:read");
  const { a, locale } = await getAdminT();
  const products = await getAdminProducts(shop.id);
  /*
   * "Product added." — said here because this is where a seller lands.
   *
   * `saveProduct` redirects a *new* product to this page rather than leaving
   * its maker on a filled-in wizard, and a redirect cannot carry a return
   * value, so the sentence travels in the query string and the row underneath
   * is the proof. Read as a flag rather than as text: what renders is this
   * app's own translated string, never anything the URL says.
   */
  const added = (await searchParams).added === "1";
  /*
   * A catalogue at the ceiling is almost certainly larger than the ceiling, so
   * the badge says "1,000+" rather than naming a number that is not the truth.
   * Silent truncation is worse than a slow page: a seller told they have a
   * thousand products goes looking for the other five hundred in the data.
   */
  const clipped = products.length >= ADMIN_PRODUCT_LIMIT;

  return (
    <>
      <PageHeader
        title={a.products.title}
        description={a.products.description}
        meta={
          products.length > 0 ? (
            <Badge tone="neutral">
              {products.length === 1
                ? "1 product"
                : `${products.length.toLocaleString(locale)}${clipped ? "+" : ""} products`}
            </Badge>
          ) : null
        }
        action={
          <div className="flex gap-2">
            {/* The CSV intake lives in Settings → Import & export; this is
                the door to it from where a seller actually stands when they
                arrive carrying a catalogue. */}
            <Link
              href="/admin/settings/data"
              className="focus-ring press inline-flex h-10 items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 text-sm font-medium text-ink-900 shadow-xs transition hover:border-ink-300 hover:bg-ink-50 pointer-coarse:h-11"
            >
              <Upload className="size-4" />
              {a.data.import}
            </Link>
            <ExportButton shop={shop} type="products" />
            <Link href="/admin/products/new">
              <Button>
                <Plus className="size-4" />
                {a.products.add}
              </Button>
            </Link>
          </div>
        }
      />

      {added ? (
        /* `mb-6` because this page spaces itself: the container the layout
           hands every admin screen has no rhythm of its own, and PageHeader
           carries its own `mb-6`. Without it the sentence sits on the table. */
        <Alert tone="success" className="mb-6">
          {a.productForm.added}
        </Alert>
      ) : null}

      {products.length === 0 ? (
        <EmptyState
          art={<TagsArt />}
          title={a.products.empty}
          description={a.products.emptyBody}
          action={
            <Link href="/admin/products/new">
              <Button>
                <Plus className="size-4" />
                {a.products.addFirst}
              </Button>
            </Link>
          }
        />
      ) : (
        <Table
          minWidth="46rem"
          head={
            <>
              <Th>{a.columns.product}</Th>
              <Th>{a.columns.status}</Th>
              <Th align="end">{a.columns.price}</Th>
              <Th align="end">{a.columns.stock}</Th>
              <Th className="w-24">
                <span className="sr-only">{a.columns.actions}</span>
              </Th>
            </>
          }
        >
          {products.map((product) => {
            const range = priceRange(product, product.variants);
            const sellable =
              product.inStock && anySellable(product, product.variants);
            // With variants, the useful number is everything on the shelf.
            const stock = product.trackInventory
              ? product.variants.length > 0
                ? product.variants.reduce(
                    (sum, v) => sum + (v.stockQuantity ?? 0),
                    0,
                  )
                : unitsLeft(product)
              : null;

            const href = `/admin/products/${product.id}`;

            return (
              <Tr key={product.id}>
                <Td>
                  <Link
                    href={href}
                    className="focus-ring flex min-w-0 items-center gap-3 rounded pointer-coarse:min-h-11"
                  >
                    <span className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-ink-100">
                      {product.images[0] ? (
                        <Image
                          src={product.images[0].url}
                          alt=""
                          fill
                          sizes="40px"
                          className="object-cover"
                        />
                      ) : (
                        <span className="flex size-full items-center justify-center text-ink-300">
                          <ImageIcon className="size-4" />
                        </span>
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink-900">
                        {product.title}
                      </span>
                      <span className="block truncate text-xs text-ink-400">
                        {[
                          product.category?.name,
                          product.kind !== "physical" ? product.kind : null,
                          product.variants.length > 0
                            ? product.variants.length === 1
                              ? a.products.variantCountOne
                              : interpolate(a.products.variantCount, {
                                  count: product.variants.length,
                                })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </span>
                    </span>
                  </Link>
                </Td>

                <Td label={a.columns.status}>
                  {/* One chip, not five. The row's status is the single fact
                      that changes what you'd do about it. */}
                  <span className="flex flex-wrap gap-1.5">
                    {!product.isPublished ? (
                      <Badge tone="amber" dot>
                        {a.common.hidden}
                      </Badge>
                    ) : !sellable ? (
                      <Badge tone="red" dot>
                        {a.common.soldOut}
                      </Badge>
                    ) : (
                      <Badge tone="green" dot>
                        {a.common.live}
                      </Badge>
                    )}
                    {product.isFeatured ? (
                      <Badge tone="blue">{a.common.featured}</Badge>
                    ) : null}
                  </span>
                </Td>

                <Td
                  align="end"
                  label={a.columns.price}
                  className="tabular whitespace-nowrap text-ink-900"
                >
                  {range.varies
                    ? `from ${formatMoney(range.min, shop.currency, locale)}`
                    : formatMoney(range.min, shop.currency, locale)}
                </Td>

                <Td
                  align="end"
                  label={a.columns.stock}
                  className="tabular whitespace-nowrap"
                >
                  {stock === null ? (
                    <span className="text-ink-300">—</span>
                  ) : (
                    <span className={stock > 0 ? "text-ink-700" : "text-red-600"}>
                      {stock}
                    </span>
                  )}
                </Td>

                <Td align="end">
                  <span className="flex items-center justify-end gap-1">
                    <form action={toggleProductPublished}>
                      <input type="hidden" name="id" value={product.id} />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        type="submit"
                        title={product.isPublished ? "Hide" : "Publish"}
                        aria-label={
                          product.isPublished ? "Hide product" : "Publish product"
                        }
                      >
                        {product.isPublished ? (
                          <Eye className="size-4" />
                        ) : (
                          <EyeOff className="size-4" />
                        )}
                      </Button>
                    </form>

                    <form action={deleteProduct}>
                      <input type="hidden" name="id" value={product.id} />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        type="submit"
                        title={a.common.delete}
                        aria-label={a.products.deleteProduct}
                        className="text-ink-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </form>
                  </span>
                </Td>
              </Tr>
            );
          })}
        </Table>
      )}

      <LearnMore topic={a.products.title} href={`${docsUrl()}/guides/products`} />
    </>
  );
}
