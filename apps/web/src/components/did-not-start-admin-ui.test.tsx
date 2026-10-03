import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DidNotStartAdmin } from "./did-not-start-admin";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("TASK 006E ej-start-admin-UI", () => {
  it("serverrenderar svenskt privat login-skal utan deltagardata", () => {
    const html = renderToStaticMarkup(<DidNotStartAdmin raceId="10000000-0000-4000-8000-000000000001" />);
    expect(html).toContain("Logga in för ej-startbeslut");
    expect(html).toContain('type="password"');
    expect(html).not.toMatch(/Ada Löpare|12345|frozenProjection|evaluation/);
  });

  it("håller beslutet capabilityseparerat och retry endast explicit i React-minne", () => {
    const component = source("./did-not-start-admin.tsx");
    const handlers = source("../lib/did-not-start-admin-route-handlers.ts");
    expect(source("../app/admin/[raceId]/did-not-start/page.tsx")).toContain("<DidNotStartAdmin raceId={raceId}");
    expect(source("../app/api/admin/races/[raceId]/did-not-start-session/route.ts")).toContain("didNotStartAdminLoginRoute");
    expect(source("../app/api/admin/races/[raceId]/entries/[entryId]/did-not-start/route.ts")).toContain("authenticatedDidNotStartRoute");
    expect(handlers).toContain('expectedCapability: "DECIDE_DID_NOT_START"');
    expect(handlers).toContain('capability: "DECIDE_DID_NOT_START"');
    expect(component).toContain('`did-not-start:${current.requestId}`');
    expect(component).toContain("submitAttempt(attempt)");
    expect(component).not.toMatch(/localStorage|sessionStorage|indexedDB|setTimeout|setInterval/);
  });

  it("länkar privat yta, headers, touchmål och visar DNS som ej start", () => {
    expect(source("./race-overview-admin.tsx")).toContain("/did-not-start`}");
    expect(source("../../next.config.ts")).toContain("did-not-start");
    expect(source("../app/globals.css")).toContain(".did-not-start-admin button { min-height: 52px; }");
    expect(source("../i18n/sv.ts")).toContain('DNS: "Ej start"');
    expect(source("./public-results.tsx")).toContain("sv.publicResultsStatusLabels[row.status]");
  });
});
