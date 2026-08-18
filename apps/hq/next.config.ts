import type { NextConfig } from "next";

/**
 * Sailo HQ — the panel we run the company from, served from hq.sailo.store.
 *
 * Not to be confused with apps/web's `/admin`, which is what a *seller* runs
 * their shop from and stays in apps/web. This app is staff-only: who signed
 * up, who is paying, what everyone is selling, and the chargebacks against it.
 *
 * WHAT IS DELIBERATELY ABSENT
 * `cacheComponents` is off, and that is the single biggest difference from
 * apps/web. Every route here sits behind `requireStaff()` and reads live
 * platform state, so there is no static shell to build and nothing a CDN could
 * hold. In apps/web that flag is load-bearing — it is what keeps storefronts
 * and marketing pages out of the request path — and its cost is that every
 * session-bound segment must declare `export const instant = false` to say so.
 * HQ is *entirely* session-bound, so enabling it would mean writing that line
 * on every page in the app to buy nothing. The lines went away with the split.
 *
 * No image pipeline either: HQ renders tables of other people's data, and the
 * one place a product photo appears it is already a Blob URL rendered at thumb
 * size. Nothing here justifies an optimiser.
 */
const nextConfig: NextConfig = {
  /*
   * The transitive closure of what this app imports, and nothing else — the
   * workspace packages ship TypeScript source (`exports` points at
   * `./src/index.ts`), so Next compiles them itself.
   *
   * A package missing from this list fails at build time with an import error
   * that reads like a bug in the package, so add to it when a dependency is
   * added — not before. Kept in sync with `package.json` by hand, the same way
   * apps/api does it.
   */
  transpilePackages: [
    "@sailo/core",
    "@sailo/db",
    "@sailo/design-system",
    "@sailo/email",
    "@sailo/env",
    "@sailo/observability",
    "@sailo/rate-limit",
    "@sailo/security",
  ],
  /*
   * lucide-react is a flat export: hundreds of icons behind one entry point,
   * of which the sidebar and tables use a few dozen. Same reasoning as
   * apps/web. visx is *not* here — the charts come with the panel move and
   * this list grows then, not in advance.
   */
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },

  /**
   * Security headers, and this is where the split pays for itself.
   *
   * apps/web's CSP has to name Stripe.js, Google Tag Manager, Vercel Analytics,
   * the Meta pixel and the TikTok pixel, because storefronts load all of them
   * and a seller can switch two of them on. It also carries `'unsafe-inline'`
   * on scripts with a comment conceding that the policy "is not a
   * script-injection defence", and cannot adopt a nonce because `cacheComponents`
   * needs the prerender.
   *
   * None of that applies here. HQ loads no third-party script at all — it
   * *links* to Stripe's dashboard, which is an anchor tag, not a script host —
   * and it has no `cacheComponents` prerender to protect. So this policy is
   * what apps/web's would like to be: no external script origin, no external
   * connect origin, no frames.
   *
   * That matters more here than anywhere else in the product. This is the one
   * origin where a single compromised session can read every seller's revenue
   * and every buyer's personal data, so it is the origin least able to afford
   * a permissive policy.
   *
   * `'unsafe-inline'` remains on both, and honestly: on styles it is Tailwind's
   * inline style attributes, and on scripts it is Next's inline bootstrap.
   * Removing the script one needs a nonce pipeline, which this app — unlike
   * apps/web — is actually free to adopt later, because nothing here is
   * prerendered. That is a follow-up, not a claim about today.
   */
  async headers() {
    /*
     * React's development build calls `eval` to reconstruct callstacks across
     * environments, and a policy without this takes the dev overlay with it.
     * Production never needs it, which is why it is scoped rather than kept.
     */
    const devEval = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";

    /*
     * Transport hardening is production-only, for the reason apps/web
     * documents at length: `upgrade-insecure-requests` rewrites subresources
     * to https, WebKit does not exempt loopback, and `next dev` over http then
     * serves a page whose own CSS and JS fail the TLS handshake. HSTS is worse
     * — it pins that for two years in a store this repo cannot reach.
     */
    const isProd = process.env.NODE_ENV === "production";

    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${devEval}`,
      "style-src 'self' 'unsafe-inline'",
      // Product thumbnails in the catalogue tables come from Blob. `data:` is
      // for inline SVG icons; `blob:` for the CSV/PDF exports the panel builds
      // client-side before handing them to a download.
      "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com",
      "font-src 'self' data:",
      // Same-origin only. HQ talks to its own server actions and route
      // handlers and to nothing else on the internet.
      "connect-src 'self'",
      // No third party is embedded here, and HQ is never embedded anywhere.
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
          /*
           * Stricter than apps/web's, which has to be
           * `same-origin-allow-popups` because Stripe.js opens Connect
           * onboarding in a window. Nothing here opens a window it needs to
           * keep talking to.
           */
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          /*
           * Every powerful feature off, including the camera. apps/web has
           * `camera=(self)` for the door scanner; there is no scanner here.
           */
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          /*
           * Staff-only, and behind an allowlist — but a stray link in a
           * support email should not be able to put any of it in an index
           * either. The panel layout sets `robots` metadata too; this covers
           * the route handlers, which have no metadata to set.
           */
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
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

export default nextConfig;
