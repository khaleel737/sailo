import type { getAccountDetail } from "@/lib/hq";

/** What one account's page is built from. */
type Result = NonNullable<Awaited<ReturnType<typeof getAccountDetail>>>;

/**
 * `getAccountDetail` returns a union: an owner who never finished onboarding
 * has no shop and so none of the shop's data. The tables below only ever
 * render on the loaded branch, and naming it here is what lets them read
 * `detail.affiliates` without each one re-proving the shop exists.
 */
export type AccountDetail = Extract<Result, { affiliates: unknown }>;
export type AccountShop = NonNullable<AccountDetail["shop"]>;
