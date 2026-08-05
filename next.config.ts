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
