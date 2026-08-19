import type { getAccountCommerce, getAccountHeader } from "@/lib/platform";

/**
 * What the four tables on the commerce tab are built from.
 *
 * This used to alias `getAccountDetail`, the one function that loaded an entire
 * account in thirteen parallel queries, and it needed an `Extract` to pick the
 * branch where a shop exists — that function returned a union, because an owner
 * who never finished onboarding has no shop and so none of the shop's data.
 *
 * The union is gone with the split: `getAccountCommerce` takes a shop id, so
 * there is no shape it returns that lacks one. The alias stays because four
 * components read it, and because naming the loader once is what stops each of
 * them re-deriving it slightly differently.
 */
export type AccountCommerce = Awaited<ReturnType<typeof getAccountCommerce>>;

/** The shop those tables render against. Never null on the commerce tab. */
export type AccountShop = NonNullable<
  NonNullable<Awaited<ReturnType<typeof getAccountHeader>>>["shop"]
>;
