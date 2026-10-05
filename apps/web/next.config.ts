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
      { key: "Content-Security-Policy", value: "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" }
    ];
    return [
      // Avläsningen behöver Web Serial för USB-stationen.
      { source: "/readout/:path*", headers: [...shellHeaders,
        { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(), serial=(self)" }] },
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
    "@o-tid/domain",
    "@o-tid/iof-xml"
  ]
};

export default nextConfig;
