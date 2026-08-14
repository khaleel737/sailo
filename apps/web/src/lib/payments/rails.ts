/**
 * The payment rails, now in `@sailo/payments/rails`.
 *
 * Kept as a re-export rather than deleted: twenty-three files import
 * `@/lib/payments`, and the barrel next door re-exports this. The rules had to
 * leave because `packages/api` answers "can this shop be paid" for the mobile
 * onboarding checklist, and it cannot reach into `apps/web`.
 *
 * That question is the reason a second copy would be dangerous rather than
 * merely untidy. `isRailUsable` is what makes cash on delivery, a bank transfer
 * and a WhatsApp handoff count as ways to get paid — so a copy that drifts
 * tells a seller in a market where nobody takes cards that their shop is
 * broken, while it is working.
 */

export * from "@sailo/payments/rails";
