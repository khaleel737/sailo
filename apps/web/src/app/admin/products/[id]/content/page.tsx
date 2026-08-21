import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { productFiles, products } from "@sailo/db/schema";
import { PageHeader } from "@sailo/design-system/web";
import { collectionForProduct, itemsFor } from "@sailo/commerce/content";
import { can } from "@sailo/core/plans";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { CollectionEditor } from "./_components/collection-editor";

export const metadata: Metadata = { title: "Gated content" };

/**
 * The seller's collection editor. Spec 40.
 *
 * Its own sub-route rather than a card inside the product form, and the reason
 * is what a collection is: a list with an order, whose items each have a
 * section, a body and a drip override. That is a screen, and folding it into a
 * form that already carries pricing, stock, variants, files and delivery would
 * make the longest form in the product longer for the feature least likely to
 * be used on any given visit.
 *
 * Reached from the product page, and only for the two kinds that have a
 * delivery page to show a collection on.
 */
export default async function ProductContentPage({
  params,
}: PageProps<"/admin/products/[id]/content">) {
  const { id } = await params;
  const { shop } = await requireShop("products:read");
  const db = getDb();

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, id), eq(products.shopId, shop.id)),
  });
  // Somebody else's product answers exactly as one that does not exist.
  if (!product) notFound();

  const [files, collection, { a }] = await Promise.all([
    db
      .select({ id: productFiles.id, name: productFiles.name })
      .from(productFiles)
      .where(eq(productFiles.productId, product.id)),
    collectionForProduct(product.id),
    getAdminT(),
  ]);

  const items = collection ? await itemsFor(collection.id) : [];

  return (
    <>
      <PageHeader
        title={a.content.title}
        description={a.content.intro}
        back={{ href: `/admin/products/${product.id}`, label: product.title }}
      />

      <CollectionEditor
        productId={product.id}
        productKind={product.kind}
        collection={collection}
        items={items}
        files={files}
        /*
         * Drip is a Business feature. The switch is shown either way and the
         * refusal explains — a control that is simply absent teaches a seller
         * the feature does not exist rather than that it is on another plan.
         */
        dripAllowed={can(shop, "collections")}
      />
    </>
  );
}
