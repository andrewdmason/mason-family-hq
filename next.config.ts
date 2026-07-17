import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // pdfjs-dist ships an ESM build that must not be bundled/mangled by the
  // server compiler; keep it external so it loads as a real Node module.
  // @napi-rs/canvas supplies the DOMMatrix/ImageData/Path2D globals pdfjs needs
  // in a serverless Node runtime — it's a native module, so it must stay
  // external (unbundled) too, or PDF conversion throws "DOMMatrix is not defined".
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  // pdfjs's worker is loaded via a computed import the bundler can't trace, so
  // force the file into the function bundle. (convert.ts also imports it with a
  // static specifier; this is belt-and-suspenders against tracing missing it.)
  // Keyed for both the resolved route and its route-group path.
  outputFileTracingIncludes: {
    "/reader/api/convert": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
    "/(reading)/reader/api/convert": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
  // Self-hosted Chrome extension artifacts (force-install). Chrome validates the
  // CRX by its magic bytes, not Content-Type, so these headers are correctness
  // hygiene rather than a hard requirement.
  async headers() {
    return [
      {
        source: "/extension/mason-reader.crx",
        headers: [{ key: "Content-Type", value: "application/x-chrome-extension" }],
      },
      {
        source: "/extension/updates.xml",
        headers: [{ key: "Content-Type", value: "application/xml" }],
      },
    ];
  },
};

export default nextConfig;
