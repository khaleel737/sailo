/**
 * The address this deployment answers on, as mail has to name it.
 *
 * WHY THIS IS NOT IMPORTED FROM apps/web
 *
 * `apps/web/src/lib/seo.ts` owns the same two values and is staying there — it
 * is the module that builds canonicals and JSON-LD, which is a website's job
 * and not a mail package's. What mail needs is the narrow half: a base to hang
 * a link off, because every URL in an email is absolute by necessity. There is
 * no origin in an inbox to resolve a relative path against.
 *
 * Read from the environment rather than passed in, and that is the one
 * decision here worth defending. Threading an origin through every message
 * signature would put it in fifty call sites for the sake of a value that is
 * constant for the life of a process, and the failure it guards against —
 * production mailing links to localhost — is caught by the same variable being
 * wrong for the website too, which nobody misses.
 *
 * `VERCEL_PROJECT_PRODUCTION_URL` is the fallback for the same reason
 * `seo.ts` uses it: a preview deployment has no `NEXT_PUBLIC_APP_URL` of its
 * own, and mail sent from one should point at the deployment that sent it
 * rather than at production.
 */

function normalizeOrigin(value: string): string {
  try {
    /* Trailing slashes turn every link into a near-duplicate of itself, and in
       an email that is a tracking parameter nobody set. */
    return new URL(value).origin;
  } catch {
    return "http://localhost:3000";
  }
}

/**
 * A function rather than a constant, and that is not a style choice.
 *
 * It was `export const APP_URL = normalizeOrigin(process.env…)`, evaluated once
 * when the module is first imported. The moment `publicShopUrl` started reading
 * it, two of its tests began returning null: they set `NEXT_PUBLIC_APP_URL` and
 * then call, which a constant computed at import time cannot see. A test that
 * cannot vary the environment is a test that cannot check what happens on a
 * preview deployment — which is the one case this value exists to get right.
 *
 * The cost is a `process.env` read per call, which is nothing next to the
 * network request every caller is about to make.
 */
export function appOrigin(): string {
  return normalizeOrigin(
    process.env.NEXT_PUBLIC_APP_URL ||
      process.env.EXPO_PUBLIC_APP_URL ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "http://localhost:3000"),
  );
}

/** A path, as a link an inbox can follow. */
export const absolute = (path: string): string =>
  new URL(path, appOrigin()).toString();

/* -------------------------------------------------------------------------- */
/*  The documentation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Where the developer documentation lives — a different host from the product.
 *
 * `apps/docs`, served from `docs.sailo.store`. It used to be a route group
 * inside apps/web, which is why several places still spelled the link
 * `/docs/api` as though it were a path on this origin. It is not, and a
 * relative link from the seller admin or the footer now lands on a 404.
 *
 * Here rather than in apps/docs because the callers are spread across the
 * repository and only one of them is that app: the marketing footer, the admin
 * sidebar, the integrations settings card, and the `contact.url` in the OpenAPI
 * document `@sailo/api` builds. Four copies of a hostname is three chances for
 * one to rot when it moves.
 *
 * Read from the environment for the same reason `appOrigin` is: a preview
 * deployment should link to whatever documentation was deployed with it, not to
 * production's.
 */
export function docsOrigin(): string {
  return normalizeOrigin(
    process.env.NEXT_PUBLIC_DOCS_URL ||
      process.env.EXPO_PUBLIC_DOCS_URL ||
      "https://docs.sailo.store",
  );
}

/** A path on the documentation site, absolute. */
export const docsUrl = (path = "/"): string => new URL(path, docsOrigin()).toString();
