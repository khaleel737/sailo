import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its .afm font metrics from disk at runtime; bundling rewrites
  // those paths and it can't find them. Keep it as a plain Node dependency.
  serverExternalPackages: ["pdfkit"],
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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://*.stripe.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://picsum.photos https://images.unsplash.com https://*.stripe.com",
      "font-src 'self' data:",
      // Stripe.js posts to its own API; the app posts only to itself.
      "connect-src 'self' https://api.stripe.com https://*.stripe.com",
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
