import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@sailo/db"],
  /*
   * Static shells with dynamic holes, instead of every route being
   * request-bound. See `src/i18n/lang-script.ts` for the one await that was
   * holding the whole product out of the CDN.
   */
  cacheComponents: true,
  // pdfkit reads its .afm font metrics from disk at runtime; bundling rewrites
  // those paths and it can't find them. Keep it as a plain Node dependency.
  serverExternalPackages: ["pdfkit"],
  /*
   * Flat-export packages, where importing one symbol pulls the whole surface
   * unless Next is told to rewrite the import.
   *
   * visx is the case this exists for: eight small packages, each re-exporting
   * everything it owns, imported from a client component that ships on the
   * seller dashboard. lucide-react is the same shape — hundreds of icons behind
   * one entry point, of which the app uses a few dozen.
   */
  experimental: {
    optimizePackageImports: [
      "@visx/axis",
      "@visx/curve",
      "@visx/event",
      "@visx/grid",
      "@visx/group",
      "@visx/responsive",
      "@visx/scale",
      "@visx/shape",
      "lucide-react",
    ],
  },
  /*
   * Image optimisation, sized for a catalogue rather than a magazine.
   *
   * Every distinct (source, width, quality) is its own optimiser run and its
   * own stored object. One shop barely notices; fifty thousand shops multiply
   * whatever this config allows by every product photo they upload, so the
   * numbers below are chosen to be the smallest set that still looks right.
   */
  images: {
    remotePatterns: [
      // Vercel Blob — where product images land.
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      // Used by the demo seeds only.
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
    /*
     * 3840 is gone; everything else is the Next default.
     *
     * That entry exists for full-bleed hero images on 4K displays. Nothing
     * here is full-bleed: the widest container in the app is 46rem — 736px —
     * so the largest honest request is about 2208px on a 3x display, and 2048
     * covers it. Generating a 3840px copy of every product photo was a second
     * optimiser run and a second stored object per image, for pixels no
     * layout can show.
     */
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048],
    /*
     * Explicit, and required from Next 16 on: an unrestricted list lets any
     * caller mint a new variant by asking for a quality nobody chose, and
     * each one is optimised and stored separately. Nothing in the app passes
     * `quality`, so this is the single value everything already uses.
     */
    qualities: [75],
    /*
     * Thirty days, matching what Vercel Blob already sends upstream — the
     * longer of the two wins, so this is really a floor for images served
     * from anywhere else.
     *
     * Safe to set this high specifically because Blob URLs are content
     * addressed: replacing a product photo uploads to a new URL rather than
     * overwriting the old one. The usual objection to a long TTL — that
     * there is no way to invalidate an optimised image — cannot bite when
     * the source URL changes on every edit.
     */
    minimumCacheTTL: 2_592_000,
    /*
     * WebP only, deliberately. AVIF is roughly a fifth smaller again, but
     * Next stores every format separately, so enabling both doubles the
     * stored variants for every image in the product. At this catalogue size
     * that trade goes the other way.
     */
    formats: ["image/webp"],
  },
  /**
   * Security headers.
   *
   * The CSP is the one that matters: Stripe.js and Stripe's hosted checkout
   * rely on it to bound what a successful XSS could do on a page handling
   * payments. Without a policy, an injected script has the same reach as ours.
   *
   * `'unsafe-inline'` on styles is Tailwind's inline style attributes, and on
   * scripts it covers Next's inline bootstrap; both are needed until a nonce
   * pipeline is in place, and both are narrower than no policy at all.
   */
  async headers() {
    /*
     * React's development build calls `eval` — to reconstruct callstacks
     * across environments, among other debugging features — and says so in the
     * console when a policy blocks it. Removing `'unsafe-eval'` outright took
     * the dev server's error overlay with it, and the checkout e2e suite
     * caught that within one run: the overlay is itself `role="dialog"`, so
     * every test looking for the checkout panel found two.
     *
     * Production never needs it, which is the whole point of scoping it here
     * rather than keeping it everywhere.
     */
    const devEval = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";

    const csp = [
      "default-src 'self'",
      /*
       * Analytics has to be named here or it does not run. Both tags failed
       * silently in production for exactly this reason: the browser blocks the
       * script, the page looks fine, and the dashboards stay empty — there is
       * nothing to notice unless you read the console on the deployed site.
       *
       * googletagmanager serves gtag.js; vercel-scripts serves the Web
       * Analytics script in development. In production Vercel serves its own
       * from `/_vercel/insights/…`, which is same-origin and already covered
       * by 'self'.
       */
      /*
       * `'unsafe-eval'` is development-only, matching Next's own example.
       *
       * Nothing in the production bundle needs it — not Stripe.js, not gtag —
       * so in production it is absent and `eval`/`new Function` are off the
       * table for an injected script. React's dev build does need it.
       *
       * `'unsafe-inline'` has to stay, and it is worth being honest about what
       * that costs: with it, an injected `<script>` runs, so this policy is
       * not a script-injection defence. What it still buys is real — no
       * external script host, `object-src 'none'`, `base-uri 'self'`,
       * `frame-ancestors 'none'`, and a `connect-src`/`form-action` narrow
       * enough to bound where a successful XSS could send what it stole.
       *
       * A nonce is the usual answer and is architecturally unavailable here:
       * Next's CSP guide is explicit that a nonce requires the page to be
       * dynamically rendered, and this app's central decision is
       * `cacheComponents` with static shells. Buying the nonce means giving up
       * the prerender on every page, which is a worse trade than this.
       */
      /*
       * facebook.net and analytics.tiktok.com are the seller-configured
       * pixels (`lib/shop-pixels.ts`), loaded on storefronts after a buyer
       * consents. They have to be named here for the same reason the Google
       * hosts are — blocked scripts fail silently and the seller's dashboard
       * just stays empty. Named globally because headers cannot tell
       * `/{handle}` from our own routes; only storefronts ever mount them.
       *
       * This is also the boundary for what a seller's GTM container can do:
       * a tag inside it that loads a further script from a host not listed
       * here is blocked. Deliberate — Meta and TikTok are first-class fields
       * precisely so nobody needs a container that pulls in arbitrary hosts.
       */
      /*
       * `'wasm-unsafe-eval'` is the QR decoder, and it is narrower than it
       * sounds: it permits WebAssembly compilation and nothing else — no
       * `eval`, no `new Function`. Without it Chrome refuses to instantiate
       * any module once a CSP is present, and the door scanner fails on the
       * one platform where it was already going to be hardest to notice,
       * because `'unsafe-eval'` masks it in development and is deliberately
       * absent in production.
       *
       * Safari needs it too and iOS needs the wasm at all: Safari has never
       * shipped `BarcodeDetector`, so on an iPhone — which is what a seller
       * is holding at a door — this decoder is the only scanner there is.
       */
      `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${devEval} https://js.stripe.com https://*.stripe.com https://www.googletagmanager.com https://va.vercel-scripts.com https://connect.facebook.net https://analytics.tiktok.com`,
      "style-src 'self' 'unsafe-inline'",
      // Google Analytics still falls back to a tracking pixel in some paths,
      // and the Meta pixel's namesake fallback is an image request to /tr.
      "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://picsum.photos https://images.unsplash.com https://*.stripe.com https://www.google-analytics.com https://www.googletagmanager.com https://www.facebook.com https://analytics.tiktok.com",
      "font-src 'self' data:",
      /*
       * Stripe.js posts to its own API; the app posts only to itself. The two
       * analytics tags beacon out as well — Google to its collect endpoints,
       * Vercel to a same-origin path already covered by 'self'. Without these
       * the scripts load and then every event is dropped, which is the same
       * empty dashboard as before but harder to spot.
       */
      "connect-src 'self' https://api.stripe.com https://*.stripe.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://www.facebook.com https://analytics.tiktok.com",
      // Checkout, the billing portal and Connect onboarding are iframed or
      // opened by Stripe.js.
      "frame-src https://js.stripe.com https://hooks.stripe.com https://*.stripe.com",
      "form-action 'self' https://checkout.stripe.com https://*.stripe.com",
      // Nothing here should ever be framed by someone else.
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            /*
             * `allow-popups`, not bare `same-origin`: Stripe Connect
             * onboarding and the billing portal are opened in a window by
             * Stripe.js, and the strict form severs the opener they need.
             *
             * COEP is deliberately absent — it would block the Stripe iframes
             * the checkout depends on, and cross-origin isolation buys this
             * app nothing since it uses no SharedArrayBuffer.
             */
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          {
            key: "Permissions-Policy",
            /*
             * `camera=(self)`, because the check-in screen is a camera.
             *
             * This said `camera=()` — off for everyone including us — which
             * is the correct default for a shop and was the correct default
             * right up until a door had to scan five hundred QR codes. A
             * header is a harder no than a permission prompt: `getUserMedia`
             * rejects before the browser ever asks, so the scanner would have
             * shipped as a black rectangle with no error a seller could act
             * on. Still nothing for third parties — `self` is this origin
             * only, and the Stripe iframes are unaffected.
             *
             * The microphone stays off. Nothing here records anything.
             */
            value: "camera=(self), microphone=(), geolocation=(), interest-cohort=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },

  async redirects() {
    return [
      // Billing moved under Settings.
      {
        source: "/admin/billing",
        destination: "/admin/settings/billing",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
