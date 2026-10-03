import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WithoutTimingWithdrawalAdmin } from "./without-timing-withdrawal-admin";

function source(relativePath: string): string { return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8"); }

describe("TASK 006N utan-tidtagning-återtagande-UI", () => {
  it("serverrenderar privat login-skal utan resultatsfakta", () => {
    const html = renderToStaticMarkup(<WithoutTimingWithdrawalAdmin raceId="10000000-0000-4000-8000-000000000001" />);
    expect(html).toContain("Logga in för återtagande utan tidtagning");
    expect(html).toContain('type="password"');
    expect(html).not.toMatch(/Ada Löpare|elapsed/);
  });
  it("kräver bekräftelse och explicit same-id retry i minnet", () => {
    const component = source("./without-timing-withdrawal-admin.tsx");
    expect(component).toContain('setAttemptPhase("CONFIRM")');
    expect(component).toContain('attemptPhase === "CONFIRM"');
    expect(component).toContain('setAttemptPhase("UNKNOWN")');
    expect(component).toContain("without-timing-withdrawal:${current.requestId}");
    expect(component).not.toMatch(/localStorage|sessionStorage|indexedDB|setTimeout|setInterval/);
  });
  it("håller capability, cookie, route och touchyta separat", () => {
    expect(source("../lib/without-timing-withdrawal-admin-route-handlers.ts")).toContain('capability: "WITHDRAW_WITHOUT_TIMING"');
    expect(source("../lib/without-timing-withdrawal-admin-cookies.ts")).toContain("__Host-otid-without-timing-withdrawal-admin-session");
    expect(source("../app/admin/[raceId]/without-timing-withdrawals/page.tsx")).toContain("<WithoutTimingWithdrawalAdmin");
    expect(source("../../next.config.ts")).toContain("/admin/:raceId/without-timing-withdrawals");
    expect(source("../app/globals.css")).toContain(".without-timing-withdrawal-admin button");
  });
});
