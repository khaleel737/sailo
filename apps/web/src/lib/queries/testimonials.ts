import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { shopTag } from "@/lib/cache";
import { approvedTestimonials } from "@sailo/marketing/testimonials/server";
import { CHECKOUT_TESTIMONIAL_CAP } from "@sailo/marketing/testimonials";
import type { Testimonial } from "@sailo/db/schema";

/**
 * What a storefront shows, cached under the shop's own tag — spec 35.
 *
 * `"use cache"` + `cacheTag(shopTag(id))`, like every other public read: rule 9.
 * Approving, unapproving or deleting one revalidates that tag, which is what
 * makes an approval appear rather than waiting out a cache — and, in the other
 * direction, what takes an unapproved one off a page it should never have been
 * on.
 *
 * The checkout gets the same rows through the same cache entry rather than a
 * second query. Spec 35 says the checkout must not gain a fetch, and the way to
 * guarantee that is for it not to have one: it slices what the page already
 * read.
 */
export async function getShopTestimonials(shopId: string): Promise<Testimonial[]> {
  "use cache";
  cacheLife("max");
  cacheTag(shopTag(shopId));
  return approvedTestimonials({ shopId, limit: 24 });
}

/**
 * Three, and the cap is a decision rather than a page-size.
 *
 * A wall under the products is browsing; three lines in the basket is
 * reassurance at the moment somebody is deciding. Twenty of them there is a
 * scroll between a buyer and the pay button.
 */
export function checkoutTestimonials(all: Testimonial[]): Testimonial[] {
  return all.slice(0, CHECKOUT_TESTIMONIAL_CAP);
}
