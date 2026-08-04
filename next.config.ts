import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Vercel Blob — where product images land.
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      // Used by the demo seed only.
      { protocol: "https", hostname: "picsum.photos" },
    ],
  },
};

export default nextConfig;
