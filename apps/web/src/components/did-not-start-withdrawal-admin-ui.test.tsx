import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DidNotStartWithdrawalAdmin } from "./did-not-start-withdrawal-admin";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("TASK 006F DNS-återtagnings-UI", () => {
  it("serverrenderar svenskt privat login-skal utan deltagar- eller resultatdata", () => {
    const html = renderToStaticMarkup(
      <DidNotStartWithdrawalAdmin raceId="10000000-0000-4000-8000-000000000001" />
    );
    expect(html).toContain("Logga in för återtagande");
    expect(html).toContain('type="password"');
    expect(html).not.toMatch(/Ada Löpare|12345|punch|evaluation|resultRevisionId/);
  });

  it("kräver ett separat andra bekräftelsesteg innan POST", () => {
    const component = source("./did-not-start-withdrawal-admin.tsx");
    expect(component).toContain('setAttemptPhase("CONFIRM")');
    expect(component).toContain('attemptPhase === "CONFIRM"');
    expect(component).toContain("onClick={() => void submitAttempt(attempt)}");
    expect(component).not.toContain("void submitAttempt(created)");
    expect(component).not.toMatch(/localStorage|sessionStorage|indexedDB|setTimeout|setInterval/);
  });

  it("håller capability, cookies och exact retry separata från rätten att skapa DNS", () => {
    const handlers = source("../lib/did-not-start-withdrawal-admin-route-handlers.ts");
    const component = source("./did-not-start-withdrawal-admin.tsx");
    expect(handlers).toContain('expectedCapability: "WITHDRAW_DID_NOT_START"');
    expect(handlers).toContain('capability: "WITHDRAW_DID_NOT_START"');
    expect(component).toContain('`did-not-start-withdrawal:${current.requestId}`');
    expect(component).toContain('setAttemptPhase("UNKNOWN")');
    expect(component).toContain("submitAttempt(attempt)");
    expect(source("../lib/did-not-start-withdrawal-admin-cookies.ts"))
      .toContain("__Host-otid-dns-withdrawal-admin-session");
  });

  it("kopplar sida, routes, privat header, overview-länk och handskvänliga touchmål", () => {
    expect(source("../app/admin/[raceId]/did-not-start-withdrawals/page.tsx"))
      .toContain("<DidNotStartWithdrawalAdmin raceId={raceId}");
    expect(source("../app/api/admin/races/[raceId]/did-not-start-withdrawal-session/route.ts"))
      .toContain("didNotStartWithdrawalAdminLoginRoute");
    expect(source("../app/api/admin/races/[raceId]/entries/[entryId]/did-not-start-withdrawal/route.ts"))
      .toContain("authenticatedDidNotStartWithdrawalRoute");
    expect(source("./race-overview-admin.tsx")).toContain("/did-not-start-withdrawals`}");
    expect(source("../../next.config.ts")).toContain("/admin/:raceId/did-not-start-withdrawals");
    expect(source("../app/globals.css"))
      .toContain(".did-not-start-withdrawal-admin button { min-height: 52px; }");
  });
});
