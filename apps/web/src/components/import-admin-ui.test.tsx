import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImportAdmin } from "./import-admin";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("TASK 005G importadmin-UI", () => {
  it("visar svensk password-login och den smala, ärliga säkerhetsgränsen", () => {
    const html = renderToStaticMarkup(<ImportAdmin raceId="10000000-0000-4000-8000-000000000001" />);
    expect(html).toContain("Logga in för IOF-import");
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain("resultatomräkning");
    expect(html).not.toContain("otid_org_import_v1");
  });

  it("håller credential, File, hash och request-id i React-minne utan URL eller Web Storage", () => {
    const component = source("./import-admin.tsx");
    const client = source("../lib/import-admin-client.ts");
    expect(component).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(client).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(component).toContain("setAccessCredential(\"\")");
    expect(component).toContain('body: current.file');
    expect(component).toContain('`iof-import:${current.requestId}`');
    expect(component).not.toMatch(/URLSearchParams|window\.location\s*=/);
  });

  it("behåller försök vid fel och rensar endast efter validerad bekräftelse eller explicit knapp", () => {
    const component = source("./import-admin.tsx");
    expect(component).toContain("setAttempt(created)");
    expect(component).toContain("parseIofImportResponse");
    expect(component).toContain("clearAttempt();");
    expect(component).toContain("submitAttempt(attempt)");
    expect(component).toContain("setAuthenticated(false)");
    expect(component).not.toMatch(/setTimeout|setInterval/);
  });

  it("visar StartList-delta och kräver uttrycklig resultatomräkning", () => {
    const component = source("./import-admin.tsx");
    const translations = source("../i18n/sv.ts");
    expect(component).toContain('result.report.kind === "EntryList"');
    expect(component).toContain("sv.importStartListSummary(");
    expect(translations).toContain("Inga resultat räknades om automatiskt");
    expect(translations).toContain("resultat behöver uttrycklig omräkning");
    expect(translations).toContain("tävlingsversionen ${snapshotChanged ? \"uppdaterades\" : \"var oförändrad\"}");
  });

  it("har separat importsida och race-scopade pairing-/importsessioner", () => {
    const admin = source("./race-overview-admin.tsx");
    const importPage = source("../app/admin/[raceId]/imports/page.tsx");
    const pairing = source("./pairing-admin.tsx");
    expect(admin).toContain("/imports`}");
    expect(importPage).toContain("<ImportAdmin raceId={raceId}");
    expect(pairing).toContain("/pairing-session`");
    expect(pairing).not.toContain("/api/organizer-pairing/session");
    const route = source("../app/api/races/[raceId]/imports/route.ts");
    expect(route).toContain("authenticatedIofImportRoute");
    expect(route).not.toMatch(/formData\(|importIofXml\(/);
  });

  it("lägger privata browserheaders på båda säkerhetsytorna", () => {
    const nextConfig = source("../../next.config.ts");
    expect(nextConfig).toContain('["pairing", "imports", "classes", "recalculation", "finalization"]');
    expect(nextConfig).toContain("frame-ancestors 'none'");
    expect(nextConfig).toContain('camera=(), geolocation=(), microphone=()');
    expect(nextConfig).toContain('value: "DENY"');
  });
});
