import type { NextConfig } from "next";

const localDemo = process.env.NODE_ENV === "development" && process.env.O_TID_LOCAL_DEMO === "1";
const demoTest = process.env.NODE_ENV === "development" && process.env.O_TID_DEMO_E2E === "1";
if (localDemo && demoTest) throw new Error("Lokal demo och browsertest kräver separata utvecklingsprocesser");

const nextConfig: NextConfig = {
  ...(localDemo ? { distDir: ".next-local-demo" } : demoTest ? { distDir: ".next-demo-test" } : {}),
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
    return [
      { source: "/checkin/:path*", headers: [
        { key: "Cache-Control", value: "no-cache" },
        { key: "Content-Security-Policy", value: "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" }
      ] },
      { source: "/admin/:raceId", headers: [...privateAdminHeaders] },
      { source: "/admin/events/new", headers: [...privateAdminHeaders] },
      { source: "/admin/events/eventor", headers: [...privateAdminHeaders] },
      ...["pairing", "imports", "classes", "recalculation", "finalization"].map((surface) => ({
        source: `/admin/:raceId/${surface}`,
        headers: [...privateAdminHeaders]
      })),
      { source: "/admin/:raceId/start-times", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/cards", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/entry-identity", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/manage", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/registration", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/start-list", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/forest-watch", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/speaker", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/start-list-publication", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/class-start-draw", headers: [...privateAdminHeaders] },
      { source: "/starts/:raceId", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/did-not-start", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/did-not-start-withdrawals", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/disqualifications", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/disqualification-withdrawals", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/result-approvals", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/did-not-finish", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/out-of-competition", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/out-of-competition-withdrawals", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/without-timing", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/without-timing-withdrawals", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/did-not-finish-withdrawals", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/approval-withdrawals", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/exports", headers: [...privateAdminHeaders] },
      { source: "/admin/:raceId/history", headers: [...privateAdminHeaders] },
      {
        source: "/admin/:raceId/simulator",
        headers: [
          ...privateAdminHeaders,
          { key: "X-Robots-Tag", value: "noindex, nofollow" }
        ]
      }
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
