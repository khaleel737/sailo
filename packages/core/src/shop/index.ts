/**
 * Facts about a shop and about Sailo, as every surface has to state them.
 *
 * `plans` is the entitlement gate — how far back analytics may read, how many
 * products may exist, which features a shop has. It is asked from the
 * storefront, the admin, the phone's Insights tab and the tRPC routers, which
 * is why it is here rather than in `@sailo/billing`: billing is the Stripe
 * subscription mechanics, and those four callers are not billing.
 *
 * `onboarding` is what a seller still has to do, `legal` is who is trading and
 * under which policies, `support` is the topics they can write in about.
 */
export * from "./plans";
export * from "./onboarding";
export * from "./legal";
export * from "./support";
export * from "./visibility";
