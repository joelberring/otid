import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PairingAdmin } from "./pairing-admin";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("pairing admin UI", () => {
  it("starts with a Swedish password login and an explicit narrow security boundary", () => {
    const html = renderToStaticMarkup(<PairingAdmin raceId="10000000-0000-4000-8000-000000000001" />);
    expect(html).toContain("Logga in för stationsparning");
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain("gäller endast parning av stationer");
    expect(html).not.toContain("otid_org_pair_v1");
    expect(html).not.toContain("otid_pair_v1");
  });

  it("keeps credentials and grant secrets out of URL and Web Storage", () => {
    const component = source("./pairing-admin.tsx");
    const client = source("../lib/pairing-admin-client.ts");
    expect(component).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(client).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(component).toContain("/pairing-session`");
    expect(component).not.toContain("/api/organizer-pairing/session");
    expect(component).toContain("body: JSON.stringify(parsedLogin.data)");
    expect(component).toContain('"idempotency-key": `pairing-grant:${material.grantId}`');
    expect(component).toContain('"x-otid-csrf"');
    expect(component).toContain("setAccessCredential(\"\")");
  });

  it("offers explicit same-secret retry, one-time copy/clear and text-plus-symbol statuses", () => {
    const component = source("./pairing-admin.tsx");
    const translations = source("../i18n/sv.ts");
    expect(component).toContain("submitIssue(pendingIssue)");
    expect(component).toContain("navigator.clipboard.writeText(issuedToken)");
    expect(component).toContain("setIssuedToken(undefined)");
    expect(component).toContain('method: "DELETE"');
    expect(component).toContain('ACTIVE: { symbol: "●"');
    expect(component).toContain('REDEEMED: { symbol: "✓"');
    expect(component).toContain('REVOKED: { symbol: "⊘"');
    expect(component).toContain('EXPIRED: { symbol: "◷"');
    expect(translations).toContain("spärrar inte den redan skapade stationcredentialen");
  });

  it("links the existing race admin shell to the isolated pairing page", () => {
    const adminPage = source("./race-overview-admin.tsx");
    const pairingPage = source("../app/admin/[raceId]/pairing/page.tsx");
    expect(adminPage).toContain("/pairing`}");
    expect(pairingPage).toContain("<PairingAdmin raceId={raceId}");
  });

  it("declares private page headers in Next configuration", () => {
    const nextConfig = source("../../next.config.ts");
    expect(nextConfig).toContain('["pairing", "imports", "classes", "recalculation", "finalization"]');
    expect(nextConfig).toContain('source: `/admin/:raceId/${surface}`');
    expect(nextConfig).toContain('{ key: "Cache-Control", value: "private, no-store" }');
    expect(nextConfig).toContain('{ key: "Content-Security-Policy", value: "frame-ancestors \'none\'" }');
    expect(nextConfig).toContain('{ key: "X-Frame-Options", value: "DENY" }');
  });
});
