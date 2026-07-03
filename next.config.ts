import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // afip.ts usa soap/xml2js con require dinámicos: se resuelven en runtime de Node
  serverExternalPackages: ["afip.ts", "soap", "node-forge"],
};

export default nextConfig;
