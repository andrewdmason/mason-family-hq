import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // pdfjs-dist ships an ESM build that must not be bundled/mangled by the
  // server compiler; keep it external so it loads as a real Node module.
  // @napi-rs/canvas supplies the DOMMatrix/ImageData/Path2D globals pdfjs needs
  // in a serverless Node runtime — it's a native module, so it must stay
  // external (unbundled) too, or PDF conversion throws "DOMMatrix is not defined".
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
};

export default nextConfig;
