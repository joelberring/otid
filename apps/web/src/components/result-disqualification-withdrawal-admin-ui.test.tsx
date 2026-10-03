import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultDisqualificationWithdrawalAdmin } from "./result-disqualification-withdrawal-admin";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("TASK 006G DSQ-återtagnings-UI", () => {
  it("serverrenderar eget svenskt login-skal utan privata beslut", () => {
    const html = renderToStaticMarkup(
      <ResultDisqualificationWithdrawalAdmin raceId="10000000-0000-4000-8000-000000000001" />
    );
    expect(html).toContain("Logga in för DSQ-återtagande");
    expect(html).toContain("Återtagningsnyckel");
    expect(html).toContain("Status för återtagande av diskvalifikation");
    expect(html).toContain('type="password"');
    expect(html).not.toMatch(/Ada Löpare|12345|punch|evaluation|resultRevisionId/);
  });

  it("kräver andra bekräftelsen och behåller exakt källa endast i React-minne", () => {
    const component = source("./result-disqualification-withdrawal-admin.tsx");
    expect(component).toContain('setAttemptPhase("CONFIRM")');
    expect(component).toContain('attemptPhase === "CONFIRM"');
    expect(component).toContain("expectedRestorationSourceResultRevision");
    expect(component).toContain('`manual-disqualification-withdrawal:${current.requestId}`');
    expect(component).toContain('setAttemptPhase("UNKNOWN")');
    expect(component).not.toMatch(/localStorage|sessionStorage|indexedDB|setTimeout|setInterval/);
  });

  it("håller capability, cookies, routes och sida separata från skapandet", () => {
    expect(source("../lib/result-disqualification-withdrawal-admin-route-handlers.ts"))
      .toContain('capability: "WITHDRAW_DISQUALIFICATION"');
    expect(source("../lib/result-disqualification-withdrawal-admin-cookies.ts"))
      .toContain("__Host-otid-result-disqualification-withdrawal-admin-session");
    expect(source("../app/admin/[raceId]/disqualification-withdrawals/page.tsx"))
      .toContain("<ResultDisqualificationWithdrawalAdmin raceId={raceId}");
    expect(source("./race-overview-admin.tsx")).toContain("/disqualification-withdrawals`}");
    expect(source("../../next.config.ts")).toContain("/admin/:raceId/disqualification-withdrawals");
  });
});
