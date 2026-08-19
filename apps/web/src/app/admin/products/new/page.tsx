import type { Metadata } from "next";
import { requireShop } from "@/lib/session";
import { getShopCategories } from "@/lib/queries";
import { ProductForm } from "@/app/admin/products/_components/product-form";
import { PageHeader } from "@sailo/design-system/web";
import { getAdminT } from "@/i18n/server";
import { connectState } from "@sailo/commerce/orders/server";
import { can, cheapestPlanWith } from "@sailo/core/plans";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProductPage() {
  const { a } = await getAdminT();
  const { shop } = await requireShop("products:write");
  const categories = await getShopCategories(shop.id);

  return (
    <>
      <PageHeader
        title={a.products.add}
        description={a.products.newSubtitle}
      />
      <ProductForm
        categories={categories}
        currency={shop.currency}
        /* An event's clock is the shop's, and the form names it rather than
           leaving a seller to guess whose 19:00 they just typed. Spec 43's two
           window fields read the same zone, and for a stronger reason: their
           boundaries are compared to `now` on the server. */
        timeZone={shop.timeZone}
        /* Spec 43. Decided here and again in `saveProduct`, because a form is
           not a gate — a hand-rolled POST does not render this card. */
        pricingModes={can(shop, "pricingModes")}
        pricingUpgradeTo={cheapestPlanWith("pricingModes")?.name ?? null}
        /* Spec 51 — changes the hint under the weight field, nothing else. A
           seller may record what a thing weighs on any plan; what Business buys
           is charging postage by it. */
        weightBands={can(shop, "weightBands")}
        /* Spec 48. Decided here and again in `saveProduct` for the same
           reason every other gate is: a form is not a gate, and a hand-rolled
           POST does not render this card. */
        codePools={can(shop, "codePools")}
        licensing={can(shop, "licensing")}
        membershipTerms={can(shop, "membershipTerms")}
        staffResources={can(shop, "staffResources")}
        cardReady={connectState(shop) === "active" && can(shop, "cardRails")}
        /* Spec 53. Gated here and again in `saveProduct`: a form is not a
           gate, and a downgraded shop keeps every price it typed. */
        regionalCurrencies={can(shop, "regionalPricing") ? shop.regionalCurrencies : []}
      />
    </>
  );
}
