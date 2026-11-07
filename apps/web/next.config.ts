import type { NextConfig } from "next";
import {
  BASE_SECURITY_HEADERS, READOUT_PERMISSIONS_POLICY, READOUT_SHELL_CSP
} from "./src/lib/content-security-policy";
import { NO_INDEX_HEADER, NO_INDEX_HEADER_SOURCES } from "./src/lib/no-index";

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
  // O-Tid använder inte next/image. Utan optimering svarar /_next/image 404, så bildoptimeringens angreppsyta (SSRF,
  // GHSA för Image Optimization) finns inte alls. Playwright sakerhetshuvuden kontrollerar det.
  images: { unoptimized: true },
  // ADR-0195: Docker-bygget (Dockerfile sätter OTID_SKIP_BUILD_CHECKS=1) hoppar över typkontrollen, som tog mest minne och
  // tid på servern. CI kör `pnpm typecheck` och `pnpm build` med kontrollen vid varje push; lokalt `pnpm build` kontrollerar.
  // Next 16 kör ingen ESLint i `next build`, så det finns inget att stänga av för lint.
  typescript: { ignoreBuildErrors: process.env.OTID_SKIP_BUILD_CHECKS === "1" },
  async headers() {
    const privateAdminHeaders = [
      { key: "Cache-Control", value: "private, no-store" },
      { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
      { key: "Referrer-Policy", value: "no-referrer" }
    ];
    const readout = { key: "Permissions-Policy", value: READOUT_PERMISSIONS_POLICY };
    return [
      { source: "/:path*", headers: [...BASE_SECURITY_HEADERS] },
      // Samma som `privateHeaders` i security-policy.ts; i drift går reglerna här före rutternas egna huvuden.
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" },
        { key: "Referrer-Policy", value: "no-referrer" }] },
      // Festens logga och kartan har en egen, striktare CSP (samma som i rutten).
      { source: "/api/public/parties/:raceId/logo", headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; sandbox" }] },
      { source: "/api/public/races/:raceId/map", headers: [{ key: "Content-Security-Policy", value: "default-src 'none'" }] },
      // Inga publika sidor om löpare och inget API indexeras (ADR-0186, `lib/no-index.ts`; fest steg 40, grupper steg 68).
      ...NO_INDEX_HEADER_SOURCES.map((source) => ({ source, headers: [NO_INDEX_HEADER] })),
      // Festens API (namn på gäster) sparas inte heller i någon cache.
      { source: "/api/public/parties/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      ...["", "/manage", "/readout", "/speaker", "/imports", "/party-labels", "/course-setting"].map((surface) => ({
        source: `/admin/:raceId${surface}`, headers: [...privateAdminHeaders]
      })),
      // Banläggningens fältläge (ADR-0181 beslut 6–7): telefonens position på kartan. Gäller före regeln ovan.
      { source: "/admin/:raceId/course-setting", headers: [{ key: "Permissions-Policy", value: "camera=(), geolocation=(self), microphone=()" }] },
      // Steg 67: banläggningens service worker (scope per tävling under /admin/, bara banläggningen; se service-worker.ts).
      { source: "/course-setting-sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/admin/" },
        { key: "Content-Security-Policy", value: "default-src 'none'; connect-src 'self'" }] },
      // Avläsningen och bardisken: adressen i arbetsytan och det statiska skalet som den leder till.
      { source: "/admin/:raceId/readout", headers: [readout] },
      { source: "/readout/:path*", headers: [{ key: "Cache-Control", value: "no-cache" },
        { key: "Content-Security-Policy", value: READOUT_SHELL_CSP }, { key: "Referrer-Policy", value: "no-referrer" }, readout] },
      { source: "/starts/:raceId", headers: [...privateAdminHeaders] },
      // ADR-0214: kartritarens länk. Nyckeln står i adressen: ingen cache, ingen referer och telefonens position på kartan.
      { source: "/kartfel/:token", headers: [{ key: "Cache-Control", value: "private, no-store" }, { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), geolocation=(self), microphone=()" }] },
      // Kontosidorna (ADR-0172): inte i cache, inte i ram och ingen referer (återställningslänken).
      ...["/superadmin", "/konto", "/recover", "/organizer/groups/:groupId", "/organizer/map-projects", "/organizer/map-projects/:projectId"].map((source) => ({ source, headers: [...privateAdminHeaders] }))
    ];
  },
  transpilePackages: [
    "@o-tid/application",
    "@o-tid/club-archive",
    "@o-tid/contracts",
    "@o-tid/database",
    "@o-tid/domain",
    "@o-tid/map-file",
    "@o-tid/map-revision",
    "@o-tid/route-choice"
  ]
};

export default nextConfig;
