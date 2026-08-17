/**
 * The vocabulary and arithmetic that the phone, the website and the API all
 * share — with no server code, no vendor, and no database connection in it.
 *
 * WHAT CORE IS FOR, AND WHY IT IS NOT SMALLER
 *
 * It was twenty-four files flat in one directory, which reads as a junk drawer
 * and largely was: chart geometry, blob URL guards and upload rules were in
 * here because `core` was the only package everything could reach. Those left
 * for `@sailo/design-system` and `@sailo/storage`.
 *
 * What is left is not junk, and the measurement that says so is the phone's
 * import list: it reaches for `currency`, `order-status`, `variants`,
 * `pricing`, `payment-status`, `onboarding` and `countries` directly.
 * `@sailo/commerce` carries `server-only` and `@sailo/billing` carries
 * `stripe`, so moving any of them "up" to a domain package breaks the React
 * Native bundle at bundle time — not at typecheck, and not in any test.
 *
 * So the fix was folders, not deletion:
 *
 *   ./money      currency · pricing · quote · tax-label
 *   ./orders     order-status · payment-status · order-lines
 *   ./catalog    variants
 *   ./identity   slug · handle · badge · uuid · phone
 *   ./place      countries · address
 *   ./shop       plans · onboarding · legal · support
 *   ./wire       resources
 *   ./invariant  the assertions everything else is built on
 *   ./origin     where this deployment answers
 *
 * This barrel reaches only what is safe everywhere. `./orders/order-lines` is
 * pure but `@sailo/core/wire` is imported by the webhook payload builder, so
 * neither is re-exported here — a barrel is a promise about the whole set.
 */
export * from "./money";
export * from "./orders";
export * from "./catalog";
export * from "./identity";
export * from "./place";
export * from "./shop";
export * from "./invariant";
