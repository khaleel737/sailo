import type { MetadataRoute } from "next";
import { absolute, appOrigin } from "@sailo/core/origin";

/**
 * Storefronts and the marketing page are meant to be found. Everything behind
 * a login, a one-time token or an API route is not — and several of those
 * paths carry tokens in the URL, so keeping crawlers out is a privacy measure
 * rather than a tidiness one.
 */
export default function robots(): MetadataRoute.Robots {
  // A preview deployment must never outrank production for its own copy.
  const indexable =
    !process.env.VERCEL_ENV || process.env.VERCEL_ENV === "production";

  if (!indexable) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/hq",
          "/api/",
          "/onboarding",
          "/login",
          "/signup",
          "/partner/",
          "/invoice/",
          "/download/",
        ],
      },
    ],
    sitemap: absolute("/sitemap.xml"),
    host: appOrigin(),
  };
}
