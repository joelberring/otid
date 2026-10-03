import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultFinalizationAdmin } from "./result-finalization-admin";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("TASK 006D finaliseringsadmin-UI", () => {
  it("serverrenderar svenskt privat shell med textstatus och utan finaliseringsdata", () => {
    const html = renderToStaticMarkup(
      <ResultFinalizationAdmin raceId="10000000-0000-4000-8000-000000000001" />
    );
    expect(html).toContain("Logga in för finalisering");
    expect(html).toContain('type="password"');
    expect(html).toContain("Internet");
    expect(html).toContain("Session");
    expect(html).not.toMatch(/Ada Löpare|12345|otid_org_result_finalize_v1/);
  });

  it("har separat privat sida, capabilityseparerade routes och inga automatiska retries", () => {
    const component = source("./result-finalization-admin.tsx");
    const handlers = source("../lib/result-finalization-admin-route-handlers.ts");
    expect(source("../app/admin/[raceId]/finalization/page.tsx"))
      .toContain("<ResultFinalizationAdmin raceId={raceId}");
    expect(source("../app/api/admin/races/[raceId]/result-finalization-session/route.ts"))
      .toContain("resultFinalizationAdminLoginRoute");
    expect(source("../app/api/admin/races/[raceId]/result-finalizations/route.ts"))
      .toContain("authenticatedResultFinalizationRoute");
    expect(handlers).toContain('expectedCapability: "FINALIZE_RESULTS"');
    expect(handlers).toContain('capability: "FINALIZE_RESULTS"');
    expect(component).toContain('`result-finalization:${current.requestId}`');
    expect(component).toContain("submitAttempt(attempt)");
    expect(component).not.toMatch(/localStorage|sessionStorage|indexedDB|setTimeout|setInterval/);
  });

  it("exponerar fryst Complete endast via exportcapability och hashverifierad download", () => {
    const exportUi = source("./iof-result-list-export-admin.tsx");
    const exportHandlers = source("../lib/iof-result-list-export-admin-route-handlers.ts");
    expect(source("../app/api/admin/races/[raceId]/exports/final-result-lists/route.ts"))
      .toContain("frozenRaceFinalizationListRoute");
    expect(source("../app/api/admin/races/[raceId]/exports/final-result-lists/[finalizationId]/route.ts"))
      .toContain("frozenIofResultListDownloadRoute");
    expect(exportHandlers).toContain("exportFrozenIofResultListAsAdmin");
    expect(exportUi).toContain('crypto.subtle.digest("SHA-256", buffer)');
    expect(exportUi).toContain("validateFrozenIofResultListResponse");
  });

  it("länkar vyn och lägger privata headers samt touchmål på ytan", () => {
    expect(source("./race-overview-admin.tsx")).toContain("/finalization`}");
    expect(source("../../next.config.ts"))
      .toContain('["pairing", "imports", "classes", "recalculation", "finalization"]');
    expect(source("../app/globals.css")).toContain(".result-finalization-admin button { min-height: 52px; }");
  });

  it("visar och kopierar bara den explicita publika länken efter RACE-finalisering", () => {
    const component = source("./result-finalization-admin.tsx");
    expect(component).toContain('lastResult.finalization.scope === "RACE"');
    expect(component).toContain('`/results/${raceId}/finalizations/${lastResult.finalization.id}`');
    expect(component).toContain("navigator.clipboard?.writeText");
    expect(component).toContain("copyPublicRaceFinalizationLink(lastResult.finalization.id)");
    expect(component).not.toMatch(/basisHash.*finalizations|completeXmlSha256.*finalizations|frozenProjectionHash.*finalizations/);
  });
});
