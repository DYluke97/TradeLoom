import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ["pdfjs-dist"],
  experimental: {
    middlewareClientMaxBodySize: "24mb",
  },
};

export default nextConfig;
