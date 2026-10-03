import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultApprovalWithdrawalAdmin } from "./result-approval-withdrawal-admin";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("TASK 006G återtagande av resultatgodkännandes-UI", () => {
  it("serverrenderar eget svenskt login-skal utan privata beslut", () => {
    const html = renderToStaticMarkup(
      <ResultApprovalWithdrawalAdmin raceId="10000000-0000-4000-8000-000000000001" />
    );
    expect(html).toContain("Logga in för återtagande av resultatgodkännande");
    expect(html).toContain('type="password"');
    expect(html).not.toMatch(/Ada Löpare|12345|punch|evaluation|resultRevisionId/);
  });

  it("kräver andra bekräftelsen och behåller exakt källa endast i React-minne", () => {
    const component = source("./result-approval-withdrawal-admin.tsx");
    expect(component).toContain('setAttemptPhase("CONFIRM")');
    expect(component).toContain('attemptPhase === "CONFIRM"');
    expect(component).toContain("expectedRestorationSourceResultRevision");
    expect(component).toContain('`manual-result-approval-withdrawal:${current.requestId}`');
    expect(component).toContain('setAttemptPhase("UNKNOWN")');
    expect(component).not.toMatch(/localStorage|sessionStorage|indexedDB|setTimeout|setInterval/);
  });

  it("håller capability, cookies, routes och sida separata från skapandet", () => {
    expect(source("../lib/result-approval-withdrawal-admin-route-handlers.ts"))
      .toContain('capability: "WITHDRAW_RESULT_APPROVAL"');
    expect(source("../lib/result-approval-withdrawal-admin-cookies.ts"))
      .toContain("__Host-otid-result-approval-withdrawal-admin-session");
    expect(source("../app/admin/[raceId]/approval-withdrawals/page.tsx"))
      .toContain("<ResultApprovalWithdrawalAdmin raceId={raceId}");
    expect(source("./race-overview-admin.tsx")).toContain("/approval-withdrawals`}");
    expect(source("../../next.config.ts")).toContain("/admin/:raceId/approval-withdrawals");
  });
});
