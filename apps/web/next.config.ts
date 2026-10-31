import type { NextConfig } from "next";
import {
  BASE_SECURITY_HEADERS, READOUT_PERMISSIONS_POLICY, READOUT_SHELL_CSP
} from "./src/lib/content-security-policy";

/**
 * Svarshuvuden (PLAN.md steg 46). Ordningen spelar roll: när flera regler sätter samma huvud gäller den sista.
 * - Alla svar: BASE_SECURITY_HEADERS (nosniff, Referrer-Policy, X-Frame-Options DENY). Ingen sida behöver bäddas in.
 * - Next-sidorna får sin CSP med nonce i `src/proxy.ts`; API-svaren har sin egen i `lib/security-policy.ts`
 *   (`default-src 'none'`), och här får API:t en reserv för svar som inte går via den.
 * - Avläsningsskalet och bardisken (`/admin/:raceId/readout` leder till `/readout/index.html`) får Web Serial och WebUSB.
 */
const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    const privateAdminHeaders = [
      { key: "Cache-Control", value: "private, no-store" },
      { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
      { key: "Referrer-Policy", value: "no-referrer" }
    ];
    // PLAN.md steg 40: fest-sidan och dess API ska inte indexeras eller sparas (namn på gäster). Bara fester har /fest/.
    const noIndex = { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noai, noimageai" };
    const readout = { key: "Permissions-Policy", value: READOUT_PERMISSIONS_POLICY };
    return [
      { source: "/:path*", headers: [...BASE_SECURITY_HEADERS] },
      // Samma som `privateHeaders` i security-policy.ts; i drift går reglerna här före rutternas egna huvuden.
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" },
        { key: "Referrer-Policy", value: "no-referrer" }] },
      // Festens logga och kartan har en egen, striktare CSP (samma som i rutten).
      { source: "/api/public/parties/:raceId/logo", headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; sandbox" }] },
      { source: "/api/public/races/:raceId/map", headers: [{ key: "Content-Security-Policy", value: "default-src 'none'" }] },
      { source: "/fest/:code", headers: [noIndex] },
      // Steg 42: QR-skylten har samma skydd.
      { source: "/fest/:code/qr", headers: [noIndex] },
      { source: "/api/public/parties/:path*", headers: [noIndex, { key: "Cache-Control", value: "private, no-store" }] },
      ...["", "/manage", "/readout", "/speaker", "/imports", "/party-labels"].map((surface) => ({
        source: `/admin/:raceId${surface}`, headers: [...privateAdminHeaders]
      })),
      // Avläsningen och bardisken: adressen i arbetsytan och det statiska skalet som den leder till.
      { source: "/admin/:raceId/readout", headers: [readout] },
      { source: "/readout/:path*", headers: [{ key: "Cache-Control", value: "no-cache" },
        { key: "Content-Security-Policy", value: READOUT_SHELL_CSP }, { key: "Referrer-Policy", value: "no-referrer" }, readout] },
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
    "@o-tid/map-file"
  ]
};

export default nextConfig;
