import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultRecalculationAdmin } from "./result-recalculation-admin";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("TASK 005I omräkningsadmin-UI", () => {
  it("server-/initialrender visar svenskt privat shell, password-login och textstatus", () => {
    const html = renderToStaticMarkup(
      <ResultRecalculationAdmin raceId="10000000-0000-4000-8000-000000000001" />
    );
    expect(html).toContain("Logga in för resultatomräkning");
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain("Internet");
    expect(html).toContain("Session");
    expect(html).toContain("Kandidater ej hämtade");
    expect(html).toContain("ny publicerad resultatrevision");
    expect(html).not.toContain("Ada Löpare");
    expect(html).not.toContain("otid_org_result_recalc_v1");
  });

  it("håller credential och fryst pending intent i React-minne utan URL eller Web Storage", () => {
    const component = source("./result-recalculation-admin.tsx");
    const client = source("../lib/result-recalculation-admin-client.ts");
    expect(component).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(client).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(component).not.toMatch(/URLSearchParams|window\.location\s*=/);
    expect(component).toContain("setAccessCredential(\"\")");
    expect(component).toContain('`result-recalculation:${current.requestId}`');
    expect(client).toContain("expectedCardAssignmentId");
    expect(client).toContain("expectedLatestResultRevision");
    expect(client).toContain("expectedEngineVersion");
  });

  it("retryar aldrig automatiskt och behåller endast okänd commit/authfel", () => {
    const component = source("./result-recalculation-admin.tsx");
    const client = source("../lib/result-recalculation-admin-client.ts");
    expect(component).toContain("isDefinitiveResultRecalculationRejection(response.status)");
    expect(component).toContain("setAttempt(undefined)");
    expect(component).toContain("submitAttempt(attempt)");
    expect(component).toContain("await loadCandidates()");
    expect(client).toContain("status === 400 || status === 404 || status === 409");
    expect(component).not.toMatch(/setTimeout|setInterval/);
  });

  it("ersätter den öppna routen och tar bort omräkningsknappen från allmän admin", () => {
    const admin = source("./race-overview-admin.tsx");
    const route = source("../app/api/races/[raceId]/entries/[entryId]/recalculate/route.ts");
    expect(admin).toContain("/recalculation`}");
    expect(admin).not.toContain("RecalculateEntryButton");
    expect(route).toContain("authenticatedResultRecalculationRoute");
    expect(route).not.toMatch(/recalculateEntry\(|error\.message|Response\.json/);
  });

  it("har privat shell, skyddad kandidat-GET och capabilityseparerad session", () => {
    const page = source("../app/admin/[raceId]/recalculation/page.tsx");
    const sessionRoute = source("../app/api/admin/races/[raceId]/recalculation-session/route.ts");
    const candidateRoute = source("../app/api/admin/races/[raceId]/recalculation-candidates/route.ts");
    const handlers = source("../lib/result-recalculation-admin-route-handlers.ts");
    expect(page).toContain("<ResultRecalculationAdmin raceId={raceId}");
    expect(page).not.toContain("raceOverview");
    expect(sessionRoute).toContain("resultRecalculationAdminLoginRoute");
    expect(candidateRoute).toContain("resultRecalculationCandidateRoute");
    expect(handlers).toContain('expectedCapability: "RECALCULATE_RESULT"');
    expect(handlers).toContain('capability: "RECALCULATE_RESULT"');
  });

  it("lägger privata browserheaders och touchvänliga operativa kontroller på sidan", () => {
    const nextConfig = source("../../next.config.ts");
    const css = source("../app/globals.css");
    expect(nextConfig).toContain('["pairing", "imports", "classes", "recalculation", "finalization"]');
    expect(nextConfig).toContain("frame-ancestors 'none'");
    expect(nextConfig).toContain('camera=(), geolocation=(), microphone=()');
    expect(nextConfig).toContain('value: "DENY"');
    expect(css).toContain(".result-recalculation-admin button { min-height: 52px; }");
    expect(css).toContain(".result-recalculation-entry");
  });
});
