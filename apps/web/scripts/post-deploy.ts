/**
 * The deploy step. Run it after a deployment is live.
 *
 *   npm run deploy:post -w @sailo/web
 *
 * Two things happen, and neither can happen during the build:
 *
 *   - **Sailo's own terms, privacy policy and refund policy are snapshotted.**
 *     Spec 46 answers a seller's subscription chargeback partly with the terms
 *     they accepted at signup, and a link to a page that has since changed is no
 *     better as our evidence than a seller's changed URL is as theirs. The pages
 *     are prose that `PRODUCTION-PLAN.md` §4 rules "leave whole", so the only
 *     way to capture a version is to read the deployed page.
 *   - **The statement descriptor is set on the platform Stripe account.**
 *     `SAILO` is recognisable and a legal entity name is not; `unrecognized`
 *     (Visa 10.4 / MC 4837) is the reason code that fixes for free.
 *
 * Content-addressed, so a deploy that changed no wording writes nothing — which
 * is what makes running it on every deploy the right default rather than a cost.
 *
 * Needs `SAILO_INTERNAL_SECRET` and the deployment's own URL. Exits non-zero on
 * a refusal so a pipeline notices, and prints what the route reported.
 */

const origin =
  process.env.DEPLOY_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const secret = process.env.SAILO_INTERNAL_SECRET;

if (!secret) {
  console.error(
    "deploy:post needs SAILO_INTERNAL_SECRET — the same value the deployment has.",
  );
  process.exit(1);
}

const response = await fetch(new URL("/api/internal/deploy", origin), {
  method: "POST",
  headers: { "x-sailo-internal": secret },
});

const body: unknown = await response.json().catch(() => null);
console.log(JSON.stringify(body, null, 2));

if (!response.ok) {
  console.error(`deploy:post failed: ${response.status}`);
  process.exit(1);
}
