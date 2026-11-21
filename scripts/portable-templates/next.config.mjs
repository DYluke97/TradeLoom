/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  serverExternalPackages: ["pdfjs-dist"],
  experimental: {
    middlewareClientMaxBodySize: "24mb",
  },
};

export default nextConfig;