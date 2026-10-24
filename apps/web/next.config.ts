import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    const privateAdminHeaders = [
      { key: "Cache-Control", value: "private, no-store" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" }
    ];
    const shellHeaders = [
      { key: "Cache-Control", value: "no-cache" },
      { key: "Content-Security-Policy", value: "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" }
    ];
    // PLAN.md steg 40: fest-sidan och dess API ska inte indexeras eller sparas (namn på gäster). Bara fester har /fest/.
    const noIndex = { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noai, noimageai" };
    return [
      { source: "/fest/:code", headers: [noIndex] },
      { source: "/api/public/parties/:path*", headers: [noIndex, { key: "Cache-Control", value: "private, no-store" }] },
      // Avläsningen behöver Web Serial för USB-stationen.
      { source: "/readout/:path*", headers: [...shellHeaders,
        { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(), serial=(self), usb=(self)" }] },
      ...["", "/manage", "/readout", "/speaker", "/imports"].map((surface) => ({
        source: `/admin/:raceId${surface}`, headers: [...privateAdminHeaders]
      })),
      { source: "/starts/:raceId", headers: [...privateAdminHeaders] },
      // Kontosidorna (ADR-0172): inte i cache, inte i ram och ingen referer (återställningslänken).
      ...["/superadmin", "/konto", "/recover"].map((source) => ({ source, headers: [...privateAdminHeaders] }))
    ];
  },
  transpilePackages: [
    "@o-tid/application",
    "@o-tid/contracts",
    "@o-tid/database",
    "@o-tid/domain"
  ]
};

export default nextConfig;
