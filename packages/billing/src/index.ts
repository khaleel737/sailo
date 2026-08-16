/**
 * The Stripe subscription a seller's plan is charged through.
 *
 * WHY THIS IS NOT `@sailo/payments`
 *
 * Two completely different questions had been sharing a package because both
 * of them end up calling Stripe:
 *
 *   - a **buyer** pays a **seller** — a card checkout on a storefront, cash at
 *     a market stall, a bank transfer, a WhatsApp handoff, and the Connect
 *     account the money lands in. That is `@sailo/payments`.
 *   - a **seller** pays **Sailo** — a plan, what it entitles them to, the
 *     subscription behind it and the customer record it hangs off. That is
 *     here.
 *
 * They share a vendor and nothing else. They have different customers,
 * different failure modes, and different people asking about them; the only
 * thing that ever made them one package was that `stripe` appears in both.
 * `plans.ts` sat in `@sailo/core` for the same non-reason — it was the only
 * place everything could reach.
 *
 * The split has a practical edge too. `plans` is the entitlement gate: it
 * decides how far back analytics may read, how many products may exist, which
 * features a shop has. That question gets asked from the storefront, the
 * admin, the phone's Insights tab and the tRPC routers, and every one of those
 * now reaches for something named after what it is asking.
 *
 * Split by the question each part answers:
 *
 *   ./checkout  — the Stripe Checkout Session an upgrade is created with
 *   ./customer  — the Stripe customer a subscription hangs off
 *   ./sync      — writing a subscription's state back onto the shop row
 *   ./map       — the shop columns a plan change sets, in one place
 */

export * from "./checkout";
export * from "./customer";
export * from "./map";
export * from "./sync";
