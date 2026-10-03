import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultDisqualificationAdmin } from "./result-disqualification-admin";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("TASK 006G diskvalifikations-UI", () => {
  it("serverrenderar svenskt privat login-skal utan deltagardata", () => {
    const html = renderToStaticMarkup(
      <ResultDisqualificationAdmin raceId="10000000-0000-4000-8000-000000000001" />
    );
    expect(html).toContain("Logga in för diskvalifikation");
    expect(html).toContain('type="password"');
    expect(html).not.toMatch(/Ada Löpare|12345|punch|evaluation|resultRevisionId/);
  });

  it("kräver ett separat andra steg, memory-only intent och explicit same-id-retry", () => {
    const component = source("./result-disqualification-admin.tsx");
    expect(component).toContain('setAttemptPhase("CONFIRM")');
    expect(component).toContain('attemptPhase === "CONFIRM"');
    expect(component).toContain("onClick={() => void submitAttempt(attempt)}");
    expect(component).not.toContain("void submitAttempt(createResultDisqualificationAttempt");
    expect(component).toContain('setAttemptPhase("UNKNOWN")');
    expect(component).not.toMatch(/localStorage|sessionStorage|indexedDB|setTimeout|setInterval/);
  });

  it("kopplar separat capability, cookies, routes, overview och touchmål", () => {
    expect(source("../lib/result-disqualification-admin-route-handlers.ts"))
      .toContain('capability: "DISQUALIFY_RESULT"');
    expect(source("../lib/result-disqualification-admin-cookies.ts"))
      .toContain("__Host-otid-result-disqualification-admin-session");
    expect(source("../app/admin/[raceId]/disqualifications/page.tsx"))
      .toContain("<ResultDisqualificationAdmin raceId={raceId}");
    expect(source("./race-overview-admin.tsx")).toContain("/disqualifications`}");
    expect(source("../../next.config.ts")).toContain("/admin/:raceId/disqualifications");
    expect(source("../app/globals.css"))
      .toContain(".result-disqualification-admin button, .result-disqualification-withdrawal-admin button { min-height: 52px; }");
  });
});
