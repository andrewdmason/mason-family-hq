import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // pdfjs-dist ships an ESM build that must not be bundled/mangled by the
  // server compiler; keep it external so it loads as a real Node module.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
