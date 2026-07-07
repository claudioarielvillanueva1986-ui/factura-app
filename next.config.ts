import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // afip.ts usa soap/xml2js con require dinámicos: se resuelven en runtime de Node
  serverExternalPackages: ["afip.ts", "soap", "node-forge"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // CSP en modo Report-Only por ahora: no bloquea nada, solo reporta
          // en consola qué violaría la política. Sirve para ajustar el
          // script-src (Next inyecta scripts que necesitarán nonce) antes de
          // pasarla a modo enforcing. Una vez validada, renombrar el header a
          // "Content-Security-Policy".
          {
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "object-src 'none'",
              "frame-ancestors 'none'",
              "img-src 'self' data: blob:",
              "style-src 'self' 'unsafe-inline'",
              "script-src 'self'",
              "connect-src 'self' https://*.supabase.co https://api.mercadopago.com",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
