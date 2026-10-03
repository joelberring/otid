import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EntryClassAdmin } from "./entry-class-admin";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("TASK 005H klassadmin-UI", () => {
  it("server-/initialrender visar endast svenskt privat shell och password-login", () => {
    const html = renderToStaticMarkup(<EntryClassAdmin raceId="10000000-0000-4000-8000-000000000001" />);
    expect(html).toContain("Logga in för klassändring");
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="off"');
    expect(html).not.toContain("Ada Löpare");
    expect(html).not.toContain("otid_org_entry_class_v1");
  });

  it("håller credential och pending försök i React-minne utan URL eller Web Storage", () => {
    const component = source("./entry-class-admin.tsx");
    const client = source("../lib/entry-class-admin-client.ts");
    expect(component).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(client).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(component).toContain("setAccessCredential(\"\")");
    expect(component).toContain('`entry-class-change:${current.requestId}`');
    expect(component).not.toMatch(/URLSearchParams|window\.location\s*=/);
  });

  it("behåller endast okänd commit/authfel och rensar definitiva 400/404/409", () => {
    const component = source("./entry-class-admin.tsx");
    const client = source("../lib/entry-class-admin-client.ts");
    expect(component).toContain("isDefinitiveEntryClassRejection(response.status)");
    expect(component).toContain("setAttempt(undefined)");
    expect(component).toContain("submitAttempt(attempt)");
    expect(client).toContain("status === 400 || status === 404 || status === 409");
    expect(component).not.toMatch(/setTimeout|setInterval/);
  });

  it("ersätter den öppna mutationens enda route utan parallell bypass", () => {
    const route = source("../app/api/races/[raceId]/entries/[entryId]/class/route.ts");
    expect(route).toContain("authenticatedEntryClassChangeRoute");
    expect(route).not.toMatch(/changeEntryClass\(|request\.json\(|error\.message/);
  });

  it("separerar skyddad klassändring från den egna skyddade omräkningsytan", () => {
    const admin = source("./race-overview-admin.tsx");
    const recalculateRoute = source("../app/api/races/[raceId]/entries/[entryId]/recalculate/route.ts");
    expect(admin).toContain("/classes`}");
    expect(admin).toContain("/recalculation`}");
    expect(admin).not.toContain("RecalculateEntryButton");
    expect(admin).not.toContain("ClassEditor");
    expect(recalculateRoute).toContain("authenticatedResultRecalculationRoute");
    expect(recalculateRoute).not.toMatch(/recalculateEntry\(|error\.message/);
  });

  it("har privat shell-sida, skyddad data-GET och browserheaders", () => {
    const page = source("../app/admin/[raceId]/classes/page.tsx");
    const nextConfig = source("../../next.config.ts");
    expect(page).toContain("<EntryClassAdmin raceId={raceId}");
    expect(page).not.toContain("raceOverview");
    expect(nextConfig).toContain('["pairing", "imports", "classes", "recalculation", "finalization"]');
    expect(nextConfig).toContain("frame-ancestors 'none'");
    expect(nextConfig).toContain('camera=(), geolocation=(), microphone=()');
  });
});
