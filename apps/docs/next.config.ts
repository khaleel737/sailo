import nextra from "nextra";
import type { NextConfig } from "next";

/**
 * Sailo's developer documentation — docs.sailo.store.
 *
 * Its own deployment rather than a route group inside apps/web, which is where
 * these pages used to live. Three things forced the split, and none of them are
 * tidiness:
 *
 * - The documentation is the page somebody reads *before* they have an account.
 *   In apps/web it shared a build with the storefront, the checkout and the
 *   seller admin, so a docs typo shipped through the same pipeline that ships
 *   payment code, and a rollback of one was a rollback of both.
 * - It shared that app's dependency tree. Stripe, better-auth, Drizzle, the PDF
 *   renderer and the barcode decoder are all in the graph of an app whose docs
 *   pages read nothing but constants.
 * - And it could not be given a hostname. `docs.sailo.store` is what a
 *   developer types and what a search result should carry; a path on the
 *   marketing site is neither.
 *
 * WHAT IT IS ALLOWED TO IMPORT
 *
 * `@sailo/api`, `@sailo/core` and `@sailo/webhooks` — and only for their
 * *constants*. The endpoint catalogue, the MCP tool list, the webhook event
 * list and the wire resource types. Nothing here opens a database, mints a key
 * or reads a request: every page is prerendered from data that is already in
 * the repository.
 *
 * That import is the whole architecture of this app. Prose describing an API by
 * hand is prose that is wrong the first time somebody adds a route and stays
 * wrong with total confidence, so anything enumerable is generated from the
 * same value the server answers with, and `src/lib/contract.test.ts` fails the
 * build when a route exists that no page describes.
 */
const withNextra = nextra({
  /*
   * Pagefind, built from the rendered HTML by `postbuild`. It indexes what a
   * reader actually sees, which for this site is the point: the endpoint
   * tables, the tool arguments and the field descriptions are all generated at
   * render time, so an index built from the MDX source would find the prose and
   * none of the reference.
   */
  search: { codeblocks: false },
  defaultShowCopyCode: true,
  /*
   * `readingTime` is off. It is a blog affordance — "7 min read" answers a
   * question somebody browsing asks — and nobody reads an endpoint reference
   * end to end. On a page that is mostly a generated table the estimate is also
   * simply wrong, because the table is not in the source it counts.
   */
  staticImage: true,
});

const nextConfig: NextConfig = {
  /*
   * The workspace packages ship TypeScript source (`exports` points straight at
   * `./src/index.ts`), so Next has to compile them itself. This is the
   * transitive closure of what this app imports and nothing more — a package
   * missing from here fails the build with an import error that reads like a
   * bug in the package.
   */
  transpilePackages: ["@sailo/api", "@sailo/core", "@sailo/webhooks", "@sailo/workflows"],

  /**
   * Security headers.
   *
   * Stricter than apps/web's can be, for the same reason apps/hq's is: this
   * site loads no third-party script, embeds no payment iframe and has no
   * analytics tag. It is static HTML about an API. So the policy names no
   * external origin at all, and there is nothing here that would like it to.
   *
   * `'unsafe-inline'` stays on both directives and honestly — on styles it is
   * the theme's inline custom properties, and on scripts it is Next's own
   * bootstrap. Neither is a script-injection defence; what is, is that no page
   * in this app renders user input.
   */
  async headers() {
    const isProd = process.env.NODE_ENV === "production";

    /*
     * React's development build calls `eval` to reconstruct callstacks across
     * environments, and a policy without this takes the dev overlay with it.
     *
     * `'unsafe-eval'` also permits WebAssembly, so it subsumes the
     * `'wasm-unsafe-eval'` below in development.
     */
    const devEval = isProd ? "" : " 'unsafe-eval'";

    const csp = [
      "default-src 'self'",
      /*
       * `'wasm-unsafe-eval'` is what makes search work, and leaving it out is a
       * failure with no symptom: the page renders, the search box opens, and
       * every query returns nothing while the console says
       * "Compiling or instantiating WebAssembly module violates the following
       * Content Security policy directive".
       *
       * Pagefind runs its index through WebAssembly, and Chromium refuses to
       * compile a module under any CSP that does not say so. It is the narrow
       * directive on purpose — it permits WebAssembly compilation and nothing
       * else, where `'unsafe-eval'` would also hand back `eval()` over
       * arbitrary strings for no benefit. Firefox and Safari allow WASM without
       * either, so this is Chromium-shaped and harmless elsewhere.
       */
      `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${devEval}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      /*
       * Same-origin only — except that Pagefind fetches its own index from
       * `/_pagefind`, which is same-origin too. Nothing here talks to the
       * internet; the `curl` examples are text for a reader to copy, not
       * requests this page makes.
       */
      "connect-src 'self'",
      "frame-src 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      ...(isProd ? ["upgrade-insecure-requests"] : []),
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          ...(isProd
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default withNextra(nextConfig);
