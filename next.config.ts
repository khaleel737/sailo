import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
  images: {
    remotePatterns: [
      // Vercel Blob — where product images land.
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      // Used by the demo seeds only.
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://*.stripe.com https://www.googletagmanager.com https://va.vercel-scripts.com",
      "style-src 'self' 'unsafe-inline'",
      // Google Analytics still falls back to a tracking pixel in some paths.
      "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://picsum.photos https://images.unsplash.com https://*.stripe.com https://www.google-analytics.com https://www.googletagmanager.com",
      "font-src 'self' data:",
      /*
       * Stripe.js posts to its own API; the app posts only to itself. The two
       * analytics tags beacon out as well — Google to its collect endpoints,
       * Vercel to a same-origin path already covered by 'self'. Without these
       * the scripts load and then every event is dropped, which is the same
       * empty dashboard as before but harder to spot.
       */
      "connect-src 'self' https://api.stripe.com https://*.stripe.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com",
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
            key: "Permissions-Policy",
            // Nothing here needs a camera or a microphone; payment is Stripe's
            // iframe, which asks for its own permission.
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
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
